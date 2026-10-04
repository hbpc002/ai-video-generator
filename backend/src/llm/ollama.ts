import { ChatMessage, ChatOptions, LLMError, Provider } from "./types";

const DEFAULT_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";

/**
 * 本地 Ollama 适配器（走它的 OpenAI 兼容端点）。
 *
 * 价值：课程设计和 Manim 代码生成都可以完全离线跑，零成本、可反复试。
 * 代价：本地小模型的 JSON 纪律和 Manim API 正确率明显低于云端大模型，
 * 所以主要适合「先跑通链路」和「大批量粗筛」，出稿仍建议用云端模型复核。
 */
export class OllamaProvider implements Provider {
  readonly name = "Ollama";

  constructor(
    private readonly defaultModel = process.env.OLLAMA_MODEL || "qwen2.5:7b",
    private readonly baseURL = DEFAULT_BASE,
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model || this.defaultModel,
      messages,
      stream: false,
      // Ollama 用 format 传 schema；传对象即等价于结构化输出
      ...(opts.jsonSchema ? { format: opts.jsonSchema } : {}),
      ...(opts.jsonMode ? { format: "json" } : {}),
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens) {
      body.max_tokens = opts.maxTokens;
      body.num_predict = opts.maxTokens;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 300_000);
    let raw: string;
    try {
      const res = await fetch(`${this.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      raw = await res.text();
      if (!res.ok) {
        throw new LLMError(
          `HTTP ${res.status}: ${raw.slice(0, 300)}`,
          this.name,
          res.status,
          raw,
        );
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new LLMError(`请求超时`, this.name);
      }
      throw new LLMError(
        `${(err as Error).message}。确认 Ollama 已启动：ollama serve`,
        this.name,
      );
    } finally {
      clearTimeout(timer);
    }

    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new LLMError("响应为空", this.name);
    return text;
  }
}