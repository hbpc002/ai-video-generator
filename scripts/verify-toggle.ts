// 离线验证：启停是否真的影响 resolveProvider，而不只是显示层过滤。
// 用法：npx tsx scripts/verify-toggle.ts
import { resolveProvider } from "../backend/src/llm";

const attempt = (spec?: string): string => {
  try {
    const p = resolveProvider(spec);
    return `✅ 解析成功 → ${p.name}`;
  } catch (e) {
    return `⛔ 拒绝：${(e as Error).message}`;
  }
};

const cases: [string, string | undefined][] = [
  ["选中的模型 acme:acme-large", "acme:acme-large"],
  ["被停用的模型 acme:acme-mini", "acme:acme-mini"],
  ["未被停用的 acme:acme-vision", "acme:acme-vision"],
];

for (const [label, spec] of cases) {
  console.log(`  ${label.padEnd(30)} ${attempt(spec)}`);
}