import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAICompatProvider, pickEnv } from "./openai";
import { CUSTOM, OPENAI_COMPAT } from "./presets";
import { ChatMessage, ChatOptions, LLMError, Provider } from "./types";
import {
  configPath,
  enabledModels,
  getProvider,
  getSelected,
  listProviders as listStoreProviders,
  readiness,
  resolveApiKey,
} from "./store";

export * from "./types";

/**
 * 解析 provider 规格：`厂商:模型`，省略模型则用该厂商的第一个启用模型。
 *
 * 优先级（从高到低）：
 *   1. 命令行显式传入的 spec
 *   2. UI 里保存的「当前选择」（config/providers.json）
 *   3. LLM_PROVIDER 环境变量
 *   4. 已有 OpenAI 兼容密钥 → openai
 *   5. 已有 GEMINI_API_KEY → gemini（保持本项目原有行为）
 *
 * 停用（enabled=false）的厂商和模型在这里直接被拒绝 ——
 * 所以 UI 上的开关是真正生效的，不只是显示层的过滤。
 */
export const resolveProvider = (spec?: string): Provider => {
  const storeEntry = spec ? findInStore(spec) : fromSelected();

  if (spec) {
    if (storeEntry && !storeEntry.enabled) {
      throw new LLMError(
        `厂商「${storeEntry.name}」已被停用，请到「模型管理」里启用它，或换一个。`,
        "resolve",
      );
    }
    const wantModel = spec.split(":").slice(1).join(":") || undefined;

    // 显式指定了模型就必须校验它是否启用。
    // 少了这一步，被停用的模型仍能通过 spec 解析出来，
    // 「停用」就只是 UI 上的摆设。只给厂商不给模型时不用查——
    // 那种情况 build() 会自动挑第一个启用的模型。
    if (storeEntry && wantModel) {
      const entry = storeEntry.models.find((m) => m.id === wantModel);
      if (entry && !entry.enabled) {
        throw new LLMError(
          `模型「${wantModel}」已被停用，请到「模型管理」里启用它，或换一个。`,
          "resolve",
        );
      }
      if (!entry) {
        throw new LLMError(
          `厂商「${storeEntry.name}」下没有模型「${wantModel}」。`
          + `可用：${storeEntry.models.map((m) => m.id).join(" / ") || "（无）"}`,
          "resolve",
        );
      }
    }

    if (storeEntry) return build(storeEntry, wantModel);
  }

  if (storeEntry && storeEntry.enabled) {
    return build(storeEntry, undefined);
  }

  const raw = (process.env.LLM_PROVIDER || "").trim();
  const [vendor, ...rest] = raw ? raw.split(":") : [];
  const key = (vendor || "").toLowerCase();

  if (!key) {
    if (pickEnv(["OPENAI_API_KEY", "LLM_API_KEY"])) return openAI("openai");
    if (process.env.GEMINI_API_KEY) return gemini();
    return fail(
      "未指定 provider，且没有可用的 API key。"
      + "去「模型管理」页添加一个厂商，或设 LLM_PROVIDER。",
    );
  }

  const stored = getProvider(key);
  if (stored) {
    if (!stored.enabled) {
      throw new LLMError(
        `厂商「${stored.name}」已被停用，请到「模型管理」里启用它。`,
        "resolve",
      );
    }
    return build(stored, rest.join(":") || undefined);
  }

  if (key === "gemini" || key === "google") return gemini(model(rest));
  if (key === "claude" || key === "anthropic") {
    const apiKey = pickEnv(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]);
    if (!apiKey) return fail("缺少 ANTHROPIC_API_KEY，或在「模型管理」里配置。");
    return new AnthropicProvider(apiKey, model(rest));
  }
  if (key === "ollama" || key === "local") return new OllamaProvider(model(rest));
  return openAI(key, model(rest));
};

const model = (rest: string[]) => (rest.length ? rest.join(":") : undefined);

/** 从 store 里按 `厂商:模型` 或裸厂商名找 */
const findInStore = (spec: string) => {
  const [vendor, ...rest] = spec.split(":");
  const all = listStoreProviders();
  return (
    all.find((p) => p.vendor === vendor && (!rest.length || p.models.some((m) => m.id === rest.join(":")))) ??
    all.find((p) => p.vendor === vendor || p.id === spec)
  );
};

const fromSelected = () => {
  const sel = getSelected();
  if (!sel) return undefined;
  const p = findInStore(sel);
  return p && readiness(p).ready ? p : undefined;
};

/** 从 store 条目构造 Provider，模型默认取第一个启用的 */
const build = (p: ReturnType<typeof getProvider> & object, modelName?: string): Provider => {
  const apiKey = resolveApiKey(p);
  const enabled = p.models.filter((m) => m.enabled).map((m) => m.id);
  const useModel = modelName ?? enabled[0];

  if (p.kind === "ollama") {
    return new OllamaProvider(useModel, p.baseURL);
  }
  if (p.kind === "anthropic") {
    if (!apiKey) return fail(`${p.name} 缺少密钥`);
    return new AnthropicProvider(apiKey, useModel);
  }
  if (p.kind === "gemini") {
    if (!apiKey) return fail(`${p.name} 缺少密钥`);
    return new GeminiProvider(apiKey, useModel);
  }
  // openai-compat / custom
  if (!p.baseURL) return fail(`${p.name} 缺少 baseURL`);
  const preset = OPENAI_COMPAT[p.vendor] ?? {
    ...CUSTOM,
    supportsJsonSchema: true,
    label: p.name,
    defaultModel: useModel ?? "",
  };
  return new OpenAICompatProvider(
    { ...preset, label: p.name, defaultModel: useModel ?? "", supportsJsonSchema: preset.supportsJsonSchema },
    apiKey ?? "unused",
    p.baseURL,
    useModel ?? "",
  );
};

const gemini = (m?: string): Provider => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail("缺少 GEMINI_API_KEY，或在「模型管理」里配置。");
  return new GeminiProvider(apiKey, m);
};

const openAI = (vendor: string, m?: string): Provider => {
  const preset = vendor === "custom" ? CUSTOM : OPENAI_COMPAT[vendor];
  if (!preset) {
    throw new LLMError(
      `未知 provider "${vendor}"。OpenAI 兼容的有：${Object.keys(OPENAI_COMPAT).join(" / ")}；`
      + `另外还有 gemini / claude / ollama。`,
      "resolve",
    );
  }
  const apiKey = pickEnv(preset.envKeys);
  if (!apiKey) return fail(`缺少 ${preset.envKeys[0]}，或在「模型管理」里配置。`);

  const baseURL = preset.baseURL || process.env.LLM_BASE_URL || "";
  if (!baseURL) throw new LLMError("自定义端点需要填 baseURL", "resolve");

  const defaultModel = m || preset.defaultModel || process.env.LLM_MODEL || "";
  if (!defaultModel) throw new LLMError(`未指定模型名：${vendor}:<model>`, "resolve");

  return new OpenAICompatProvider(preset, apiKey, baseURL, defaultModel);
};

const fail = (msg: string): never => {
  throw new LLMError(msg, "resolve");
};

/** 一次性调用 + 解析 JSON，带 Markdown 围栏兜底。 */
export const chatJson = async (
  provider: Provider,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<unknown> => {
  const text = await provider.chat(messages, opts);
  return extractJson(text, provider.name);
};

/**
 * 抽取 JSON。
 *
 * 原生 structured output 一般直接就是纯 JSON，但并非所有厂商都听话，
 * 所以还是要处理 ```json 围栏和前后废话。原来的 ai.ts 是用正则硬抠，
 * 这里集中实现，顺便把报错信息做得能直接定位问题。
 */
export const extractJson = (text: string, providerName = "?"): unknown => {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续往下兜底 */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (e) {
      throw new LLMError(
        `代码围栏里的内容不是合法 JSON：${(e as Error).message}`,
        providerName,
      );
    }
  }

  // 截取第一个 { 到最后一个 } 之间，容忍前后解释性文字
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch (e) {
      throw new LLMError(
        `输出里没有可用 JSON（${(e as Error).message}）。`
        + `原始输出前 300 字：${trimmed.slice(0, 300)}`,
        providerName,
      );
    }
  }

  throw new LLMError(
    `输出里找不到 JSON。原始输出前 300 字：${trimmed.slice(0, 300)}`,
    providerName,
  );
};

/**
 * 列出可用的模型 —— 现在读的是 store（含用户自建与启停状态），
 * 不再只是扫环境变量。
 */
export const listProviders = () => {
  const models = enabledModels();
  const rows = models.map((m) => ({
    spec: m.spec,
    ready: true,
    note: m.label,
  }));
  // 没有可用模型时，至少把内置厂商的状态列出来，便于排查
  if (rows.length) return rows;
  return listStoreProviders().map((p) => {
    const r = readiness(p);
    return {
      spec: p.vendor,
      ready: r.ready,
      note: r.note,
    };
  });
};

export { configPath as providerConfigPath };
