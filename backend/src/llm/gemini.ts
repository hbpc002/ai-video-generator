import { ChatMessage, ChatOptions, LLMError, Provider } from "./types";

const HOST = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/**
 * Gemini 适配器，走原生 generateContent 协议（不用 OpenAI 兼容层，
 * 因为只有这里能用 responseSchema 拿到严格结构化输出）。
 *
 * 用全局 fetch 手写而不是 @google/genai SDK —— SDK 会拉进一大坨依赖，
 * 而这里只需要三个请求字段。
 */
export class GeminiProvider implements Provider {
  readonly name = "Gemini";

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = "gemini-2.5-flash",
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const model = opts.model || this.defaultModel;

    // Gemini 的 systemInstruction 是独立字段，不混在 messages 里
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents: GeminiContent[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const genCfg: Record<string, unknown> = {};
    if (opts.temperature !== undefined) genCfg.temperature = opts.temperature;
    if (opts.maxTokens) genCfg.maxOutputTokens = opts.maxTokens;
    if (opts.jsonSchema) {
      genCfg.responseMimeType = "application/json";
      // Gemini 的 responseSchema 不支持顶层 $schema / additionalProperties
      genCfg.responseSchema = stripUnsupported(opts.jsonSchema);
    } else if (opts.jsonMode) {
      genCfg.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(genCfg).length) body.generationConfig = genCfg;

    const url = `${HOST}/${encodeURIComponent(model)}:generateContent?key=${this.apiKey}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 120_000);
    let raw: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    };

    // 安全拦截要单独报，否则只看到"空内容"很难排查
    if (data.promptFeedback?.blockReason) {
      throw new LLMError(
        `被安全策略拦截（${data.promptFeedback.blockReason}）`,
        this.name,
      );
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("");

    if (!text) {
      const fr = data.candidates?.[0]?.finishReason;
      throw new LLMError(
        `响应为空${fr ? `（finishReason=${fr}）` : ""}。`
        + `可能是 token 超限被截断，或模型名 "${model}" 不存在。`,
        this.name,
      );
    }
    return text;
  }
}

/** Gemini 的 schema 子集比 JSON Schema 窄，去掉它不认的字段 */
const stripUnsupported = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "$schema" || k === "additionalProperties") continue;
      out[k] = stripUnsupported(v);
    }
    return out;
  }
  return schema;
};