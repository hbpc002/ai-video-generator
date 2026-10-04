// LLM 抽象层：把各家模型统一成一个 chat() 调用。
//
// 为什么不直接写死一家：
//   阶段①课程设计需要中文教学设计能力，国产模型往往更接地气、还便宜；
//   阶段② Manim 代码生成需要更强的指令遵循，贵的模型更划算。
// 分开之后每个阶段可以独立选模型，这是分两步调用的额外好处。

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 原生 structured output 的 JSON Schema。各家能力不同，见index.ts 说明。 */
  jsonSchema?: Record<string, unknown>;
  /** 只要求「输出是 JSON」而非严格 schema（退化档） */
  jsonMode?: boolean;
}

export interface Provider {
  readonly name: string;
  /** 返回纯文本。需要结构化输出时自己再 extractJson。 */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "LLMError";
  }
}