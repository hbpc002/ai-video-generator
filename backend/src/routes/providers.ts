import { Router } from "express";
import {
  configPath,
  createProvider,
  deleteProvider,
  getProvider,
  getSelected,
  listProviders,
  readiness,
  resolveApiKey,
  setSelected,
  toggleModel,
  toggleProvider,
  updateProvider,
  type ProviderEntry,
} from "../llm/store";
import { discoverModels, testProvider } from "../llm/discover";

const router = Router();

/** 对外输出时抹掉密钥，前端只需要知道「配没配」 */
const redact = (p: ProviderEntry) => {
  const key = resolveApiKey(p);
  const { apiKey, ...rest } = p;
  return {
    ...rest,
    hasInlineKey: Boolean(apiKey && apiKey.trim()),
    keyFromEnv: key ? (p.apiKeyEnv ?? "env") : null,
    status: readiness(p),
  };
};

router.get("/", (_req, res) => {
  res.json({
    providers: listProviders().map(redact),
    selected: getSelected(),
    configPath: configPath(),
  });
});

router.post("/", (req, res) => {
  try {
    const created = createProvider(req.body ?? {});
    res.json({ provider: redact(created) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const next = updateProvider(req.params.id, req.body ?? {});
    res.json({ provider: redact(next) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteProvider(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** 厂商级启停 */
router.post("/:id/toggle", (req, res) => {
  try {
    const next = toggleProvider(req.params.id, Boolean(req.body?.enabled));
    res.json({ provider: redact(next) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** 模型级启停 —— 选择器只列 enabled 的模型 */
router.post("/:id/models/:modelId/toggle", (req, res) => {
  try {
    const next = toggleModel(
      req.params.id,
      decodeURIComponent(req.params.modelId),
      Boolean(req.body?.enabled),
    );
    res.json({ provider: redact(next) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** 手动加一个模型（自动拉取失败时的兜底） */
router.post("/:id/models", (req, res) => {
  try {
    const modelId = String(req.body?.id ?? "").trim();
    if (!modelId) return res.status(400).json({ error: "模型 id 不能为空" });
    const next = updateProvider(req.params.id, {
      models: [
        ...(getProvider(req.params.id)?.models ?? []),
        { id: modelId, label: req.body?.label, enabled: true },
      ],
    });
    res.json({ provider: redact(next) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete("/:id/models/:modelId", (req, res) => {
  try {
    const id = decodeURIComponent(req.params.modelId);
    const cur = getProvider(req.params.id);
    if (!cur) return res.status(404).json({ error: "provider 不存在" });
    const next = updateProvider(req.params.id, {
      models: cur.models.filter((m) => m.id !== id),
    });
    res.json({ provider: redact(next) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** 自动获取该厂商的全部模型。合并进配置但不覆盖已有 enabled 状态 */
router.post("/:id/discover", async (req, res) => {
  const p = getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: "provider 不存在" });

  try {
    const found = await discoverModels(p, resolveApiKey(p));

    // 保留用户已有的启用状态：已存在的 id 不覆盖 enabled
    const existing = new Map(p.models.map((m) => [m.id, m]));
    const merged = [
      ...found.map((m) => existing.get(m.id) ?? { id: m.id, label: m.label, enabled: true }),
      // 手动加的、拉取列表里没有的，保留
      ...p.models.filter((m) => !found.some((f) => f.id === m.id)),
    ];

    const next = updateProvider(p.id, { models: merged });
    res.json({
      discovered: found.length,
      provider: redact(next),
    });
  } catch (err) {
    res.status(502).json({
      error: `拉取失败：${(err as Error).message}`,
      hint: "部分厂商关闭了模型列举接口，可以手动添加模型 id。",
    });
  }
});

/** 连通性测试：真发一次对话，比只看 /models 更能反映能不能用 */
router.post("/:id/test", async (req, res) => {
  const p = getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: "provider 不存在" });

  const model = String(req.body?.model ?? p.models.find((m) => m.enabled)?.id ?? "");
  if (!model) return res.status(400).json({ error: "请先指定要测试的模型" });

  const result = await testProvider(p, resolveApiKey(p), model);
  res.json({ ...result, model });
});

router.post("/selected", (req, res) => {
  try {
    setSelected(String(req.body?.spec ?? ""));
    res.json({ selected: getSelected() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;