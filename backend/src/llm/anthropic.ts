import { ChatMessage, ChatOptions, LLMError, Provider } from "./types";

const URL = "https://api.anthropic.com/v1/messages";

interface AnthropicContent {
  type: "text";
  text: string;
}

/**
 * Claude 适配器。
 *
 * 注意：Anthropic **没有** JSON mode 或 json_schema 参数，
 * 官方做法是用 tool use 强制结构化。这里用同样思路 ——
 * 把 schema 描述成一个工具，模型必须通过它输出。
 * 如果 schema 太大不适合做成工具，就退化成提示词约束 + 上层校验。
 */
export class AnthropicProvider implements Provider {
  readonly name = "Claude";

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = "claude-sonnet-4-5",
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const body: Record<string, unknown> = {
      model: opts.model || this.defaultModel,
      max_tokens: opts.maxTokens ?? 8000,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: [{ type: "text", text: m.content } as AnthropicContent],
        })),
    };
    if (system) body.system = system;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    if (opts.jsonSchema) {
      body.tools = [{
        name: "emit_output",
        description: "以结构化形式输出结果。所有字段必须完整填写。",
        input_schema: opts.jsonSchema,
      }];
      body.tool_choice = { type: "tool", name: "emit_output" };
    } else if (opts.jsonMode) {
      body.system =
        (system ? system + "\n\n" : "")
        + "只输出 JSON，不要任何解释文字或 markdown 代码围栏。";
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 120_000);
    let raw: string;
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      raw = await res.text();
      if (!res.ok) {
        throw new LLMError(
          `HTTP ${res.status}: ${raw.slice(0, 400)}`,
          this.name,
          res.status,
          raw,
        );
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new LLMError(`请求超时（${opts.timeoutMs}ms）`, this.name);
      }
      throw new LLMError((err as Error).message, this.name);
    } finally {
      clearTimeout(timer);
    }

    const data = JSON.parse(raw) as {
      content?: { type: string; text?: string; input?: unknown }[];
      stop_reason?: string;
    };

    // 走 tool use 时，结果在 tool_use 块的 input 里，而不是 text
    const toolUse = data.content?.find((c) => c.type === "tool_use");
    if (toolUse?.input !== undefined) {
      return JSON.stringify(toolUse.input);
    }

    const text = data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    if (!text) {
      throw new LLMError(
        `响应为空（stop_reason=${data.stop_reason}）。`
        + `若用了 tool use，说明模型没有调用工具，可换更小的 schema。`,
        this.name,
      );
    }
    return text;
  }
}