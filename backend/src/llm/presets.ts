// OpenAI 兼容协议的服务商预设。
//
// 一个适配器覆盖绝大多数厂商 —— DeepSeek / Qwen / Kimi / MiniMax / Groq
// 都实现了 OpenAI 的 /chat/completions，只是 baseURL 不同。
// 这样加一家新厂商只要在这里加一行，不用写新适配器。
//
// 这也是 MoneyPrinterTurbo 支持 15+ provider 的路子。

export interface OpenAICompatPreset {
  /** 环境变量名（按顺序找第一个有值的） */
  envKeys: string[];
  baseURL: string;
  /** 该厂商在 OpenAI 协议下接受的默认模型名 */
  defaultModel: string;
  /** 部分厂商（如 Qwen）只支持 json_object，不支持 json_schema */
  supportsJsonSchema?: boolean;
  label: string;
}

export const OPENAI_COMPAT: Record<string, OpenAICompatPreset> = {
  openai: {
    envKeys: ["OPENAI_API_KEY"],
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    supportsJsonSchema: true,
    label: "OpenAI",
  },
  deepseek: {
    envKeys: ["DEEPSEEK_API_KEY"],
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    supportsJsonSchema: true,
    label: "DeepSeek",
  },
  qwen: {
    envKeys: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    // 通义只认 json_object，传 json_schema 会报参数错误
    supportsJsonSchema: false,
    label: "通义千问",
  },
  kimi: {
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    supportsJsonSchema: true,
    label: "Kimi",
  },
  minimax: {
    envKeys: ["MINIMAX_API_KEY"],
    baseURL: "https://api.minimax.chat/v1",
    defaultModel: "abab6.5s-chat",
    supportsJsonSchema: false,
    label: "MiniMax",
  },
  groq: {
    envKeys: ["GROQ_API_KEY"],
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    supportsJsonSchema: false,
    label: "Groq",
  },
  openrouter: {
    envKeys: ["OPENROUTER_API_KEY"],
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    supportsJsonSchema: false,
    label: "OpenRouter",
  },
};

/** 自定义兜底：任意 OpenAI 兼容端点 */
export const CUSTOM: OpenAICompatPreset = {
  envKeys: ["LLM_API_KEY", "OPENAI_API_KEY"],
  baseURL: "",
  defaultModel: "",
  label: "自定义 OpenAI 兼容端点",
};