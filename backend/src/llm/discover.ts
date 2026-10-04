import type { ProviderEntry } from "./store";

/**
 * 自动拉取厂商的模型列表。
 *
 * 四家协议形状完全不同，这里各写一份：
 *   - OpenAI 兼容   GET {base}/models          → { data: [{ id }] }
 *   - Gemini        GET .../models?key=       → { models: [{ name: "models/x" }] }
 *   - Anthropic     GET /v1/models            → { data: [{ id }] }
 *   - Ollama        GET {base去掉/v1}/api/tags → { models: [{ name }] }
 *
 * 拉不到不是致命错误 —— 返回错误信息让 UI 提示「手动添加」，
 * 因为部分厂商（尤其国内网关）会关掉模型列举接口。
 */

export interface DiscoveredModel {
  id: string;
  label?: string;
}

export class DiscoverError extends Error {}

const TIMEOUT = 20_000;

const fetchJson = async (
  url: string,
  init: RequestInit & { timeout?: number },
): Promise<unknown> => {
  const { timeout = TIMEOUT, ...rest } = init;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { ...rest, signal: ac.signal });
    const raw = await res.text();
    if (!res.ok) {
      const detail = extractErrorMessage(raw);
      throw new DiscoverError(
        `HTTP ${res.status}${detail ? `：${detail}` : `：${raw.slice(0, 160) || res.statusText}`}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new DiscoverError("返回的不是 JSON（可能 baseURL 填错了）");
    }
  } catch (err) {
    if (err instanceof DiscoverError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new DiscoverError(`请求超时（${Math.round(timeout / 1000)}s）`);
    }
    throw new DiscoverError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
};

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const discoverModels = async (
  p: ProviderEntry,
  apiKey?: string,
): Promise<DiscoveredModel[]> => {
  const base = (p.baseURL ?? "").replace(/\/$/, "");

  if (p.kind === "gemini") {
    if (!apiKey) throw new DiscoverError("缺少 GEMINI_API_KEY，无法列举模型");
    const data = (await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { headers: { "Content-Type": "application/json" } },
    )) as { models?: { name?: string; displayName?: string }[] };

    return asArray<{ name?: string; displayName?: string }>(data.models)
      .map((m) => ({
        id: String(m.name ?? "").replace(/^models\//, ""),
        label: m.displayName,
      }))
      .filter((m) => m.id)
      // 只保留能对话的，排除 embedding / tts 之类
      .filter((m) => !/embedding|tts|image|vision|aqa|retrieval/i.test(m.id));
  }

  if (p.kind === "anthropic") {
    if (!apiKey) throw new DiscoverError("缺少 ANTHROPIC_API_KEY，无法列举模型");
    const data = (await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    })) as { data?: { id?: string; display_name?: string }[] };

    return asArray<{ id?: string; display_name?: string }>(data.data)
      .map((m) => ({ id: String(m.id ?? ""), label: m.display_name }))
      .filter((m) => m.id);
  }

  if (p.kind === "ollama") {
    // Ollama 的 OpenAI 兼容端点挂在 /v1 下，原生标签接口在 /api/tags
    const root = base.replace(/\/v1$/, "");
    const data = (await fetchJson(`${root}/api/tags`, {
      headers: { "Content-Type": "application/json" },
    })) as { models?: { name?: string; size?: number }[] };

    return asArray<{ name?: string; displayName?: string }>(data.models)
      .map((m) => ({ id: String(m.name ?? "") }))
      .filter((m) => m.id);
  }

  // openai-compat / custom
  if (!base) throw new DiscoverError("baseURL 为空，无法列举模型");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const data = (await fetchJson(`${base}/models`, { headers })) as {
    data?: { id?: string }[];
    error?: { message?: string };
  };
  const errMsg = extractErrorMessage(JSON.stringify(data));
  if (errMsg) throw new DiscoverError(errMsg);

  const list = asArray<{ id?: string }>(data.data)
    .map((m) => ({ id: String(m.id ?? "") }))
    .filter((m) => m.id);
  if (!list.length) throw new DiscoverError("接口返回空列表");
  return list;
};

/**
 * 连通性测试：真发一次最小请求。
 *
 * 和「拉模型列表」不同 —— 有些厂商 /models 开着但 chat 关闭，
 * 或者 key 没 chat 权限。只有真发一条消息才算真的能用。
 *
 * 两个实测踩到的坑：
 *  1. **推理模型会把 max_tokens 全吃掉**。AMD ROCm 上的 Qwen3.8-27B
 *     把推理放在 `reasoning` 字段，max_tokens=32 时推理就用完了，
 *     content 回来是空字符串、finish_reason="length"。
 *     所以这里给到 512，并且把「空内容 + length」判为「不确定」而非「可用」。
 *  2. **错误格式不统一**。AMD 在限流时返回
 *     `{"detail":{"error":{"message":...}}}` 而不是 OpenAI 的
 *     `{"error":{"message":...}}`，只认后者会丢掉真正的原因。
 */

const TEST_MAX_TOKENS = 512;
// 60s 是权衡：实测 AMD ROCm 上 GLM-5/DeepSeek-V4 在并发限流下会排队
// 超过 2 分钟，但让 UI 干等两分钟比快速失败更糟。
const CHAT_TIMEOUT = 60_000;

/** 把各家五花八门的错误体里真正的原因挖出来 */
const extractErrorMessage = (raw: string): string => {
  try {
    const d = JSON.parse(raw) as {
      error?: { message?: string };
      detail?: { error?: { message?: string }; message?: string };
      message?: string;
    };
    return (
      d?.error?.message
      ?? d?.detail?.error?.message
      ?? d?.detail?.message
      ?? d?.message
      ?? ""
    );
  } catch {
    return "";
  }
};

export const testProvider = async (
  p: ProviderEntry,
  apiKey: string | undefined,
  model: string,
): Promise<{
  ok: boolean;
  latencyMs: number;
  sample: string;
  error?: string;
  inconclusive?: boolean;
}> => {
  const started = Date.now();
  const base = (p.baseURL ?? "").replace(/\/$/, "");
  const ask = "回复两个字：正常";

  try {
    if (p.kind === "gemini") {
      if (!apiKey) throw new DiscoverError("缺少密钥");
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/`
        + `${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const data = (await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ask }] }],
          generationConfig: { maxOutputTokens: TEST_MAX_TOKENS },
        }),
        timeout: CHAT_TIMEOUT,
      })) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return verdict(text, data.candidates?.[0]?.finishReason, started);
    }

    if (p.kind === "anthropic") {
      if (!apiKey) throw new DiscoverError("缺少密钥");
      const data = (await fetchJson("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: TEST_MAX_TOKENS,
          messages: [{ role: "user", content: ask }],
        }),
        timeout: CHAT_TIMEOUT,
      })) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
      };
      const text = data.content?.find((c) => c.type === "text")?.text ?? "";
      return verdict(text, data.stop_reason, started);
    }

    // Ollama / OpenAI 兼容（含 AMD ROCm 这类网关）
    const url = `${base}/${p.kind === "ollama" ? "" : ""}chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey && p.kind !== "ollama") headers.Authorization = `Bearer ${apiKey}`;

    const data = (await fetchJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: ask }],
        stream: false,
        max_tokens: TEST_MAX_TOKENS,
      }),
      timeout: CHAT_TIMEOUT,
    })) as {
      choices?: {
        message?: {
          content?: string;
          // 部分网关把推理放在 reasoning / reasoning_content
          reasoning?: string;
          reasoning_content?: string;
        };
        finish_reason?: string;
      }[];
    };

    const msg = data.choices?.[0]?.message;
    const text = msg?.content?.trim() ?? "";
    const latency = Date.now() - started;

    // content 空但有推理内容 → 说明是推理模型吃掉了 token 预算，
    // 不是不可用。给个明确提示，别让用户以为坏了。
    if (!text && (msg?.reasoning || msg?.reasoning_content)) {
      return {
        ok: true,
        latencyMs: latency,
        sample: "",
        inconclusive: true,
        error:
          "模型返回了空内容——它把 token 都用在推理上了（这是推理模型的正常行为）。"
          + "实际可用，但这种模型不适合max_tokens 很小的场景。",
      };
    }

    return verdict(text, data.choices?.[0]?.finish_reason, started);
  } catch (err) {
    const msg = (err as Error).message;
    const latency = Date.now() - started;

    // 限流要给出可操作的提示，而不是干巴巴一个 429
    const rate = /429|rate.?limit|concurrency|并发|限流/i.exec(msg);
    return {
      ok: false,
      latencyMs: latency,
      sample: "",
      error: rate
        ? `${msg.trim()} —— 该模型当前并发已满（部分网关限并发 16），稍后重试或换一个模型。`
        : msg,
    };
  }
};

/** 判定：空内容 + length = 不确定（token 不够），否则正常 */
const verdict = (
  text: string,
  finishReason: string | undefined,
  started: number,
) => {
  const latencyMs = Date.now() - started;
  if (!text && (finishReason === "length" || finishReason === "max_tokens")) {
    return {
      ok: true,
      latencyMs,
      sample: "",
      inconclusive: true,
      error: "返回空内容且触发了长度上限，可能是推理模型吃光了 token 预算。",
    };
  }
  return { ok: true, latencyMs, sample: text.slice(0, 80) };
};