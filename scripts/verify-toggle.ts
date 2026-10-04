/**
 * 验证「启停」真正影响 resolveProvider，而不只是 UI 显示层过滤。
 *
 * 这是个容易做错的地方：UI 上的 checkbox 关掉了，但 resolveProvider
 * 照样能用那个 spec 解析出 provider —— 等于开关是摆设。
 *
 * 自足测试：用 PROVIDERS_CONFIG 指向临时配置，不碰真实的 providers.json。
 *
 *   npx tsx scripts/verify-toggle.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const TMP = path.join(os.tmpdir(), `providers-verify-${process.pid}.json`);

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail: string) => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}\n     ${detail}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}\n     ${detail}`);
  }
};

// tsx 跑的是 CJS，顶层 await 不支持；又必须等 PROVIDERS_CONFIG 设好之后
// 再动态 import —— store 在模块求值时就读了这个变量。只能包一层 IIFE。
const main = async () => {
  fs.writeFileSync(TMP, JSON.stringify({ version: 1, providers: [] }));
  process.env.PROVIDERS_CONFIG = TMP;

  const { resolveProvider } = await import("../backend/src/llm");
  const store = await import("../backend/src/llm/store");

  const attempt = (spec?: string) => {
    try {
      const p = resolveProvider(spec);
      return { ok: true as const, name: p.name };
    } catch (e) {
      return { ok: false as const, msg: (e as Error).message };
    }
  };

  // 声明在 try 外，否则 finally 清理时拿不到
  let created: { id: string } | undefined;

  try {
    // 两个模型：alpha 启用、beta 停用
    created = store.createProvider({
      name: "验证用网关",
      vendor: "verify-gw",
      kind: "custom",
      baseURL: "http://127.0.0.1:9/v1",
      apiKey: "dummy",
      models: [
        { id: "alpha", enabled: true },
        { id: "beta", enabled: false },
      ],
    });

    console.log("\n【1】模型级启停");
    const a = attempt("verify-gw:alpha");
    check("启用的模型可解析", a.ok, a.ok ? a.name : a.msg);

    const b = attempt("verify-gw:beta");
    check(
      "停用的模型被拒绝",
      !b.ok && /停用/.test(b.msg),
      b.ok ? `却解析成功了 → ${b.name}（开关是摆设）` : b.msg,
    );

    const missing = attempt("verify-gw:gamma");
    check(
      "不存在的模型被拒绝且列出可用项",
      !missing.ok && /没有模型/.test(missing.msg),
      missing.ok ? `却解析成功了 → ${missing.name}` : missing.msg,
    );

    console.log("\n【2】厂商级启停");
    store.toggleProvider(created.id, false);
    const c = attempt("verify-gw:alpha");
    check(
      "厂商停用后所有模型都不可用",
      !c.ok && /厂商/.test(c.msg),
      c.ok ? `却解析成功了 → ${c.name}` : c.msg,
    );

    console.log("\n【3】恢复后应重新可用");
    store.toggleProvider(created.id, true);
    const d = attempt("verify-gw:alpha");
    check("重新启用后可解析", d.ok, d.ok ? d.name : d.msg);

    console.log("\n【4】模型启停应可逆");
    store.toggleModel(created.id, "beta", true);
    const e = attempt("verify-gw:beta");
    check("停用的模型重新启用后可解析", e.ok, e.ok ? e.name : e.msg);
  } finally {
    if (created) store.deleteProvider(created.id);
    fs.rmSync(TMP, { force: true });
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.error("\n❌ 有用例失败 —— 启停可能只作用于 UI 显示层");
    process.exitCode = 1;
  } else {
    console.log("✅ 启停语义正确");
  }
};

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});