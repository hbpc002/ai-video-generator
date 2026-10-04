import React, { useCallback, useEffect, useState } from "react";
import {
  createProvider,
  deleteModel,
  deleteProvider,
  discoverModels,
  listProviders,
  selectProvider,
  testProvider,
  toggleModel,
  toggleProvider,
  updateProvider,
  type ProviderView,
} from "../api/client";

interface Props {
  onChanged: () => void;   // 通知工作台刷新模型下拉
}

const KIND_LABEL: Record<string, string> = {
  "openai-compat": "OpenAI 兼容",
  gemini: "Gemini",
  anthropic: "Anthropic",
  ollama: "Ollama",
  custom: "自定义",
};

const blank = () => ({
  name: "",
  vendor: "",
  kind: "openai-compat" as ProviderView["kind"],
  baseURL: "",
  apiKey: "",
  apiKeyEnv: "",
  enabled: true,
});

export default function ProviderAdmin({ onChanged }: Props) {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [configPath, setConfigPath] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blank());

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3200);
  };

  // 注意：load 绝不能依赖 onChanged。
  // App 那边传的是内联箭头函数，每次渲染都是新引用；
  // 若把它放进依赖链，effect 会无限重跑 → 无限请求 → 后台数据覆盖
  // 本地编辑中的内容，表现为「设置了不保存」。
  // 稳定依赖 []，并且只在变更后由 guard 主动通知外部。
  const load = useCallback(async () => {
    try {
      const r = await listProviders();
      setProviders(r.providers);
      setSelected(r.selected);
      setConfigPath(r.configPath);
    } catch (e) {
      flash("err", (e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ---- 操作 ----
  const guard = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
      onChanged();          // 只在变更后通知，不在初始加载时
    } catch (e) {
      flash("err", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDiscover = (id: string) =>
    guard(`disc-${id}`, async () => {
      const r = await discoverModels(id);
      flash("ok", `拉取到 ${r.discovered} 个模型`);
    });

  const doTest = (id: string, model: string) =>
    guard(`test-${id}-${model}`, async () => {
      const r = await testProvider(id, model);
      if (r.ok && r.inconclusive) {
        // 推理模型把 token 都花在推理上，content 为空但不代表不可用
        flash("ok", `${model} 可用 · ${r.latencyMs}ms（空回复：${r.error ?? "该模型只输出推理内容"}）`);
      } else if (r.ok) {
        flash("ok", `${model} 可用 · ${r.latencyMs}ms · 回复「${r.sample.trim()}」`);
      } else {
        flash("err", `${model} 不可用：${r.error}`);
      }
    });

  const submitNew = async () => {
    if (!draft.vendor.trim()) return flash("err", "厂商标识不能为空");
    await guard("create", async () => {
      await createProvider(draft);
      setAdding(false);
      setDraft(blank());
      flash("ok", "已添加，现在可以点「拉取模型」");
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {msg ? (
        <div className={`fixed top-4 right-4 z-50 max-w-md border rounded px-3 py-2 text-sm shadow-lg ${
          msg.kind === "ok"
            ? "bg-emerald-950 border-emerald-700 text-emerald-200"
            : "bg-red-950 border-red-700 text-red-200"
        }`}>
          {msg.text}
        </div>
      ) : null}

      <header>
        <h2 className="text-lg font-semibold text-gray-100">模型提供商</h2>
        <p className="text-xs text-gray-500 mt-1">
          配置保存在 <code className="text-gray-400">{configPath || "config/providers.json"}</code>
          （已加入 .gitignore）。密钥优先从环境变量读，避免明文落盘。
        </p>
      </header>

      {/* ---- 新增 ---- */}
      {adding ? (
        <div className="bg-gray-900/70 border border-blue-800 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-300">添加提供商</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-gray-500">显示名</span>
              <input
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
                placeholder="如：公司内部网关"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">厂商标识（唯一，小写）</span>
              <input
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
                placeholder="如：my-gateway"
                value={draft.vendor}
                onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">协议类型</span>
              <select
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProviderView["kind"] })}
              >
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">
                baseURL{kindNeedsBase(draft.kind) ? "" : "（该协议不需要）"}
              </span>
              <input
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
                placeholder="https://api.example.com/v1"
                disabled={!kindNeedsBase(draft.kind)}
                value={draft.baseURL}
                onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">密钥（可留空，改用环境变量）</span>
              <input
                type="password"
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">环境变量名（优先于上面的密钥）</span>
              <input
                className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
                placeholder="如 MY_GATEWAY_KEY"
                value={draft.apiKeyEnv}
                onChange={(e) => setDraft({ ...draft, apiKeyEnv: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-40"
              disabled={!draft.name.trim() || !draft.vendor.trim() || busy === "create"}
              onClick={submitNew}
            >
              保存
            </button>
            <button
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm"
              onClick={() => { setAdding(false); setDraft(blank()); }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm"
          onClick={() => setAdding(true)}
        >
          + 添加提供商
        </button>
      )}

      {/* ---- 列表 ---- */}
      <div className="space-y-3">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border p-3 ${
              !p.enabled ? "border-gray-800 opacity-60"
                : p.status.ready ? "border-gray-700 bg-gray-900/50"
                : "border-amber-900 bg-amber-950/20"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {/* 厂商开关 */}
              <button
                title={p.enabled ? "点击停用" : "点击启用"}
                onClick={() => guard(`t-${p.id}`, () =>
                  toggleProvider(p.id, !p.enabled))}
                className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                  p.enabled ? "bg-emerald-600" : "bg-gray-700"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  p.enabled ? "left-4.5" : "left-0.5"}`} />
              </button>

              <span className="font-medium text-sm text-gray-100">{p.name}</span>
              <code className="text-[10px] text-gray-500 bg-black/40 px-1 rounded">
                {p.vendor}
              </code>
              <span className="text-[10px] text-gray-500">{KIND_LABEL[p.kind]}</span>

              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  p.status.ready ? "bg-emerald-900/60 text-emerald-300"
                                 : "bg-gray-800 text-gray-500"}`}
              >
                {p.status.ready ? "可用" : p.status.note}
              </span>

              {selected?.startsWith(`${p.vendor}:`) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300">
                  当前使用
                </span>
              ) : null}

              <div className="ml-auto flex gap-1.5">
                <button
                  className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
                  disabled={!!busy}
                  onClick={() => doDiscover(p.id)}
                >
                  {busy === `disc-${p.id}` ? "拉取中…" : "拉取模型"}
                </button>
                {!p.builtIn ? (
                  <button
                    className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-red-900 disabled:opacity-40"
                    disabled={!!busy}
                    onClick={() => {
                      if (!confirm(`删除「${p.name}」？该操作不可撤销。`)) return;
                      void guard(`d-${p.id}`, () => deleteProvider(p.id));
                    }}
                  >
                    删除
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-600 self-center px-1">内置不可删</span>
                )}
              </div>
            </div>

            {/* 端点与密钥 */}
            <details className="mt-2">
              <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">
                连接设置
              </summary>
              <div className="grid gap-2 sm:grid-cols-2 mt-2">
                {kindNeedsBase(p.kind) ? (
                  <label className="block">
                    <span className="text-[10px] text-gray-500">baseURL</span>
                    <input
                      className="w-full mt-0.5 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                      defaultValue={p.baseURL ?? ""}
                      onBlur={(e) => void guard(`b-${p.id}`, () =>
                        updateProvider(p.id, { baseURL: e.target.value }))}
                    />
                  </label>
                ) : null}
                <label className="block">
                  <span className="text-[10px] text-gray-500">
                    密钥{p.keyFromEnv ? `（当前来自 ${p.keyFromEnv}）` : ""}
                  </span>
                  <input
                    type="password"
                    className="w-full mt-0.5 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs"
                    placeholder={p.hasInlineKey ? "已设置（留空则不改）" : "未设置"}
                    onBlur={(e) => {
                      if (!e.target.value) return;
                      void guard(`k-${p.id}`, () =>
                        updateProvider(p.id, { apiKey: e.target.value }));
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-gray-500">环境变量名</span>
                  <input
                    className="w-full mt-0.5 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                    defaultValue={p.apiKeyEnv ?? ""}
                    onBlur={(e) => void guard(`e-${p.id}`, () =>
                      updateProvider(p.id, { apiKeyEnv: e.target.value }))}
                  />
                </label>
              </div>
            </details>

            {/* ---- 模型列表 ---- */}
            <div className="mt-2 border-t border-gray-800 pt-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] text-gray-500">
                  模型（{p.models.filter((m) => m.enabled).length}/{p.models.length} 启用）
                </span>
                <AddModel provider={p} onDone={load} />
              </div>
              {p.models.length === 0 ? (
                <div className="text-[11px] text-gray-600">
                  还没有模型 —— 点右上角「拉取模型」自动获取，或手动添加。
                </div>
              ) : (
                <div className="space-y-1">
                  {p.models.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                        m.enabled ? "bg-gray-950/60" : "bg-gray-950/30 opacity-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={m.enabled}
                        title={m.enabled ? "停用该模型" : "启用该模型"}
                        onChange={() => guard(`m-${p.id}-${m.id}`, () =>
                          toggleModel(p.id, m.id, !m.enabled))}
                      />
                      <code className="flex-1 truncate">{m.id}</code>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700
                                   disabled:opacity-40"
                        disabled={!!busy}
                        onClick={() => doTest(p.id, m.id)}
                      >
                        {busy === `test-${p.id}-${m.id}` ? "测试中" : "测试"}
                      </button>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded text-gray-600 hover:text-red-400"
                        title="设为当前使用"
                        onClick={() => guard(`s-${p.id}-${m.id}`, () =>
                          selectProvider(`${p.vendor}:${m.id}`))}
                      >
                        使用
                      </button>
                      <button
                        className="text-[10px] px-1 text-gray-600 hover:text-red-400"
                        title="从列表移除"
                        onClick={() => void guard(`rm-${p.id}-${m.id}`, () =>
                          deleteModel(p.id, m.id))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const kindNeedsBase = (kind: string) =>
  kind === "openai-compat" || kind === "custom";

/** 手动加模型 —— 自动拉取失败时的兜底 */
const AddModel: React.FC<{ provider: ProviderView; onDone: () => void }> = ({
  provider, onDone,
}) => {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");

  if (!open) {
    return (
      <button
        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
        onClick={() => setOpen(true)}
      >
        + 手动添加
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        className="bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-xs font-mono w-40"
        placeholder="模型 id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter" || !id.trim()) return;
          await addModel(provider.id, id.trim());
          setId(""); setOpen(false); onDone();
        }}
      />
      <button
        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700 hover:bg-blue-600"
        disabled={!id.trim()}
        onClick={async () => {
          await addModel(provider.id, id.trim());
          setId(""); setOpen(false); onDone();
        }}
      >
        添加
      </button>
      <button
        className="text-[10px] px-1 text-gray-500 hover:text-gray-300"
        onClick={() => { setOpen(false); setId(""); }}
      >
        ✕
      </button>
    </span>
  );
};

const addModel = async (providerId: string, id: string) => {
  const { addModel: api } = await import("../api/client");
  await api(providerId, id);
};