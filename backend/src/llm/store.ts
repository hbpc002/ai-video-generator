import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { CUSTOM, OPENAI_COMPAT } from "./presets";

/**
 * provider 配置的持久化层。
 *
 * 为什么要落盘而不是只读 .env：
 *   - 模型列表要能增删改启停，.env 表达不了这些结构化状态
 *   - 自动拉取到的模型需要缓存下来，否则每次开页面都要重新请求
 *   - 想让用户能在 UI 里改，而不是每次去编辑 .env
 *
 * 优先级：store 里的配置 > 环境变量 > 内置 preset 默认值。
 * 这样保留了「.env 里已经配好就能直接用」的既有行为，
 * 同时允许 UI 覆盖。
 */

export type VendorKind = "openai-compat" | "gemini" | "anthropic" | "ollama" | "custom";

export interface ModelEntry {
  id: string;
  label?: string;
  /** 关掉的模型不会出现在选择器里，但配置保留 */
  enabled: boolean;
}

export interface ProviderEntry {
  id: string;
  /** 展示名 */
  name: string;
  vendor: string;
  kind: VendorKind;
  /** 覆盖 preset 的 baseURL；custom 厂商必填 */
  baseURL?: string;
  /** 直接存的密钥 */
  apiKey?: string;
  /** 从这个环境变量读密钥。设置后优先用它，便于密钥不落在磁盘上 */
  apiKeyEnv?: string;
  models: ModelEntry[];
  /** 整个厂商的开关。关掉后选择器不列它 */
  enabled: boolean;
  /** 内置厂商不可删除，只能停用 —— 删了用户就找不回来了 */
  builtIn?: boolean;
  note?: string;
  updatedAt?: number;
}

/**
 * 落盘的记录。内置厂商只存「与 preset 的差异」（开关/模型/密钥），
 * 不重复存 name/kind 那些由 presets 决定��字段。
 */
export type StoredProvider = { vendor?: string } & Partial<ProviderEntry>;

export interface ProvidersFile {
  version: 1;
  providers: StoredProvider[];
  /** 当前选中的 spec，形如 `deepseek:deepseek-chat` */
  selected?: string;
}

const DATA_DIR = path.resolve(__dirname, "../../../config");
const FILE = path.join(DATA_DIR, "providers.json");

/** vendor →协议类型。新增厂商时这里是唯一要动的地方 */
const KIND_OF: Record<string, VendorKind> = {
  openai: "openai-compat",
  deepseek: "openai-compat",
  qwen: "openai-compat",
  kimi: "openai-compat",
  minimax: "openai-compat",
  groq: "openai-compat",
  openrouter: "openai-compat",
  custom: "custom",
  gemini: "gemini",
  claude: "gemini", // 占位，下面单独覆盖
  ollama: "ollama",
};
KIND_OF.claude = "anthropic";
KIND_OF.google = "gemini";
KIND_OF.local = "ollama";
KIND_OF.anthropic = "anthropic";

const ENV_KEYS: Record<string, string[]> = {
  gemini: ["GEMINI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  ollama: [],
  custom: ["LLM_API_KEY", "OPENAI_API_KEY"],
  ...Object.fromEntries(
    Object.entries(OPENAI_COMPAT).map(([k, v]) => [k, v.envKeys]),
  ),
};

const pickEnv = (keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v;
  }
  return undefined;
};

const baseUrlOf = (vendor: string, override?: string): string => {
  if (override) return override;
  if (vendor === "custom") return process.env.LLM_BASE_URL ?? "";
  const preset = OPENAI_COMPAT[vendor];
  if (preset) return preset.baseURL;
  if (vendor === "ollama") {
    return process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
  }
  return "";
};

/** 内置厂商：由 presets 派生，用户可停用但不可删除 */
const builtinProviders = (): ProviderEntry[] => {
  const out: ProviderEntry[] = [];
  for (const [vendor, p] of Object.entries(OPENAI_COMPAT)) {
    out.push({
      id: `builtin-${vendor}`,
      name: p.label,
      vendor,
      kind: "openai-compat",
      baseURL: p.baseURL,
      apiKeyEnv: p.envKeys[0],
      models: [{ id: p.defaultModel, enabled: true }],
      enabled: true,
      builtIn: true,
    });
  }
  out.push({
    id: "builtin-gemini",
    name: "Gemini",
    vendor: "gemini",
    kind: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    models: [{ id: "gemini-2.5-flash", enabled: true }],
    enabled: true,
    builtIn: true,
  });
  out.push({
    id: "builtin-claude",
    name: "Claude",
    vendor: "claude",
    kind: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [{ id: "claude-sonnet-4-5", enabled: true }],
    enabled: true,
    builtIn: true,
  });
  out.push({
    id: "builtin-ollama",
    name: "Ollama（本地）",
    vendor: "ollama",
    kind: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1",
    models: [],
    enabled: true,
    builtIn: true,
    note: "本地离线，无需密钥",
  });
  return out;
};

const emptyFile = (): ProvidersFile => ({ version: 1, providers: [] });

const readRaw = (): ProvidersFile => {
  if (!fs.existsSync(FILE)) return emptyFile();
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8")) as ProvidersFile;
    if (!data || typeof data !== "object" || !Array.isArray(data.providers)) {
      return emptyFile();
    }
    return data;
  } catch {
    // 配置损坏时不要让整个服务起不来，退回内置默认
    return emptyFile();
  }
};

const writeRaw = (data: ProvidersFile): void => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
};

/**
 * 合并后的完整视图：内置厂商（可被 store 覆盖）+ 用户自建厂商。
 * 只读，不落盘。
 */
export const listProviders = (): ProviderEntry[] => {
  const raw = readRaw();
  const byVendor = new Map(raw.providers.map((p) => [p.vendor, p]));

  const merged = builtinProviders().map((b) => {
    const override = byVendor.get(b.vendor);
    return override ? { ...b, ...override, id: override.id || b.id } : b;
  });

  const builtinVendors = new Set(builtinProviders().map((b) => b.vendor));
  const custom = raw.providers.filter(
    (p) => p.vendor && !builtinVendors.has(p.vendor),
  ) as ProviderEntry[];
  return [...merged, ...custom];
};

export const getProvider = (id: string): ProviderEntry | undefined =>
  listProviders().find((p) => p.id === id || p.vendor === id);

export const saveProviders = (providers: ProviderEntry[], selected?: string): void => {
  writeRaw({ version: 1, providers, selected });
};

// ---- 增删改 ----

export const createProvider = (
  input: Partial<ProviderEntry> & { vendor: string; name: string },
): ProviderEntry => {
  const raw = readRaw();
  if (raw.providers.some((p) => p.vendor === input.vendor)) {
    throw new Error(`厂商「${input.vendor}」已存在，请直接编辑`);
  }
  const kind = KIND_OF[input.vendor] ?? (input.baseURL ? "custom" : "openai-compat");
  const entry: ProviderEntry = {
    id: input.id ?? randomUUID(),
    name: input.name,
    vendor: input.vendor,
    kind,
    baseURL: input.baseURL ?? baseUrlOf(input.vendor),
    apiKey: input.apiKey,
    apiKeyEnv: input.apiKeyEnv ?? ENV_KEYS[input.vendor]?.[0],
    models: input.models ?? [],
    enabled: input.enabled ?? true,
    builtIn: false,
    note: input.note,
    updatedAt: Date.now(),
  };
  validate(entry);
  raw.providers.push(entry);
  writeRaw(raw);
  return entry;
};

export const updateProvider = (id: string, patch: Partial<ProviderEntry>): ProviderEntry => {
  const raw = readRaw();
  // 内置厂商不落盘任何字段（它们由 presets 派生），只存「开关」差异
  const idx = raw.providers.findIndex((p) => p.id === id);
  const existingBuiltin = builtinProviders().find((b) => b.id === id || b.vendor === id);

  if (existingBuiltin) {
    const merged: ProviderEntry = {
      ...existingBuiltin,
      // 只允许改这些；名字/厂商/协议是 preset 决定的
      enabled: patch.enabled ?? existingBuiltin.enabled,
      models: patch.models ?? existingBuiltin.models,
      note: patch.note ?? existingBuiltin.note,
      apiKey: patch.apiKey,
      apiKeyEnv: patch.apiKeyEnv ?? existingBuiltin.apiKeyEnv,
      updatedAt: Date.now(),
    };
    validate(merged);
    const saved: StoredProvider = {
      id: existingBuiltin.id,
      vendor: existingBuiltin.vendor,
      enabled: merged.enabled,
      models: merged.models,
      note: merged.note,
      apiKey: merged.apiKey,
      apiKeyEnv: merged.apiKeyEnv,
    };
    if (idx >= 0) raw.providers[idx] = saved;
    else raw.providers.push(saved);
    writeRaw(raw);
    return merged;
  }

  if (idx < 0) throw new Error(`provider 不存在: ${id}`);
  const next: ProviderEntry = {
    ...(raw.providers[idx] as ProviderEntry),
    ...patch,
    id: raw.providers[idx].id ?? id,
    updatedAt: Date.now(),
  };
  validate(next);
  raw.providers[idx] = next;
  writeRaw(raw);
  return next;
};

export const deleteProvider = (id: string): void => {
  const builtin = builtinProviders().find((b) => b.id === id || b.vendor === id);
  if (builtin) {
    throw new Error("内置厂商不可删除。如果不需要，请改为「停用」。");
  }
  const raw = readRaw();
  const before = raw.providers.length;
  raw.providers = raw.providers.filter((p) => p.id !== id);
  if (raw.providers.length === before) throw new Error(`provider 不存在: ${id}`);
  writeRaw(raw);
};

/** 停用等价于「从可用列表里隐藏」，配置与密钥都保留 */
export const toggleProvider = (id: string, enabled: boolean): ProviderEntry =>
  updateProvider(id, { enabled });

export const toggleModel = (
  providerId: string,
  modelId: string,
  enabled: boolean,
): ProviderEntry => {
  const p = getProvider(providerId);
  if (!p) throw new Error(`provider 不存在: ${providerId}`);
  const models = p.models.some((m) => m.id === modelId)
    ? p.models.map((m) => (m.id === modelId ? { ...m, enabled } : m))
    : [...p.models, { id: modelId, enabled }];
  return updateProvider(providerId, { models });
};

export const setSelected = (spec: string): void => {
  const raw = readRaw();
  raw.selected = spec;
  writeRaw(raw);
};

export const getSelected = (): string | undefined => readRaw().selected;

export const resolveApiKey = (p: ProviderEntry): string | undefined => {
  if (p.apiKeyEnv) {
    const v = process.env[p.apiKeyEnv];
    if (v && v.trim()) return v;
  }
  if (p.apiKey && p.apiKey.trim()) return p.apiKey;
  return pickEnv(ENV_KEYS[p.vendor] ?? []);
};

const validate = (p: ProviderEntry): void => {
  if (!p.name?.trim()) throw new Error("名称不能为空");
  if (!p.vendor?.trim()) throw new Error("厂商标识不能为空");
  if ((p.kind === "openai-compat" || p.kind === "custom") && !baseUrlOf(p.vendor, p.baseURL)) {
    throw new Error("OpenAI 兼容厂商必须填 baseURL");
  }
};

/** 供 UI 展示：某个 provider 能不能用、缺什么 */
export const readiness = (p: ProviderEntry): { ready: boolean; note: string } => {
  if (!p.enabled) return { ready: false, note: "已停用" };
  if (p.kind === "ollama") return { ready: true, note: "本地离线，无需密钥" };
  const key = resolveApiKey(p);
  if (!key) {
    const env = p.apiKeyEnv ?? ENV_KEYS[p.vendor]?.[0];
    return {
      ready: false,
      note: env ? `缺少密钥（${env}）` : "缺少密钥",
    };
  }
  return { ready: true, note: `${p.models.filter((m) => m.enabled).length} 个可用模型` };
};

/** 启用了指定模型的 provider 列表 —— 选择器用这个 */
export const enabledModels = (): { spec: string; label: string; vendor: string }[] => {
  const out: { spec: string; label: string; vendor: string }[] = [];
  for (const p of listProviders()) {
    if (!readiness(p).ready) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      out.push({
        spec: `${p.vendor}:${m.id}`,
        label: `${p.name} · ${m.label ?? m.id}`,
        vendor: p.vendor,
      });
    }
  }
  return out;
};

export const configPath = (): string => FILE;