import {
  ChatMessage,
  ChatOptions,
  LLMError,
  Provider,
} from "./types";
import { CUSTOM, OpenAICompatPreset } from "./presets";

/**
 * OpenAI 兼容适配器，一个实现覆盖 OpenAI / DeepSeek / Qwen / Kimi /
 * MiniMax / Groq / OpenRouter —— 它们都是 /chat/completions，只是 baseURL 不同。
 *
 * 用全局 fetch（Node 18+）而不是 node-fetch，避免给 pipeline 脚本引依赖。
 */
export class OpenAICompatProvider implements Provider {
  readonly name: string;

  constructor(
    private readonly preset: OpenAICompatPreset,
    private readonly apiKey: string,
    private readonly baseURL: string,
    private readonly defaultModel: string,
  ) {
    this.name = preset.label;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const model = opts.model || this.defaultModel;

    // 结构化输出：能力支持就上严格 schema，否则退化到 json_object
    let responseFormat: unknown;
    if (opts.jsonSchema && this.preset.supportsJsonSchema !== false) {
      responseFormat = {
        type: "json_schema",
        json_schema: { name: "output", schema: opts.jsonSchema, strict: false },
      };
    } else if (opts.jsonSchema || opts.jsonMode) {
      responseFormat = { type: "json_object" };
    }

    const body: Record<string, unknown> = { model, messages, stream: false };
    if (responseFormat) body.response_format = responseFormat;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    const res = await this.post(body, opts.timeoutMs);
    const data = res as {
      choices?: { message?: { content?: string } }[];
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new LLMError(
        `响应里没有内容（choices 为空）。可能是模型名 "${model}" 不支持，`
        + `或该厂商不支持 ${opts.jsonSchema ? "结构化输出" : "chat"}。`,
        this.name,
      );
    }
    return text;
  }

  private async post(body: unknown, timeoutMs = 120_000) {
    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new LLMError(
          `HTTP ${res.status}: ${raw.slice(0, 400)}`,
          this.name,
          res.status,
          raw,
        );
      }
      return JSON.parse(raw);
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new LLMError(`请求超时（${timeoutMs}ms）`, this.name);
      }
      throw new LLMError((err as Error).message, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 从环境变量里找第一个有值的 key */
export const pickEnv = (keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v;
  }
  return undefined;
};