/**
 * 阶段②：Manim 场景代码生成（带渲染自愈）。
 *
 * 为什么单独一步：
 *   1. 代码不以转义字符串嵌在 JSON 里 —— 模型对 `r"\text{...}"` 的转义
 *      处理极容易出错，且这类 bug 极难定位。
 *   2. 代码生成是「写了就要跑」的活。模型对 Manim API 的首次正确率
 *      普遍只有 30-50%，所以真正管用的是**自愈循环**：渲失败就把
 *      stderr 喂回去让它改，而不是反复调采样参数碰运气。
 *      这是 manim-mcp / manimAnimationAgent 的共同做法。
 *
 * 验证用 `-ql -s --format=png`（只渲最后一帧），秒级返回，
 * 但 API 错误、LaTeX 错误在 construct 阶段就会暴露，足以判成败。
 *
 * ⚠️ 输入必须是 **edge_timeline.py 产出的时间轴 JSON**，不是手写的 lesson JSON。
 * 因为要给模型列出「哪些词可以作为 wait_for 锚点、各自什么时刻」，
 * 这些词级时间戳只有跑完 TTS 才有。sceneCode 也是写回时间轴，
 * render_manim.py 随后从同一份文件里取。
 *
 * 用法：
 *   npm run lesson:timeline -- scripts/lesson-勾股定理.json -o tmp/t.json
 *   npx tsx pipeline/gen-manim.ts tmp/t.json
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import { resolveProvider } from "../backend/src/llm";
import type { Beat, VisualEvent } from "../backend/src/lesson/types";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ROOT = path.resolve(__dirname, "..");
const PIPELINE = path.join(ROOT, "pipeline");
const MANIM_BIN =
  process.env.MANIM_BIN ||
  path.join(PIPELINE, "manim-venv", "bin", "manim");

// ---- Manim API 约束：写进提示词，比事后debug 快得多 ----
const API_RULES = `## Manim 环境（务必遵守，违反会直接渲染失败）

- 版本 **0.21.0**（Community Edition）
- 帧尺寸：宽 14.222、高 8.0 个单位，即 x∈[-7.11, 7.11]、y∈[-4, 4]
- **任何内容都不能超出这个范围**，否则会被裁掉。
  宽度不确定时用 \`.scale_to_fit_width(n)\` 自适应，不要手调 font_size。
- 公式用 \`MathTex\`；中文正文用 \`Text(..., font="Noto Serif SC")\`；
  公式里要写中文，必须 \`tex_template=CjkTexTemplate()\`（已从 manim_theme 导入）
- **不要用** OpenGL 相关类、\`Axes\` 的 \`get_axis_labels\`、
  \`DecimalNumber\`、3D 相机等未验证的 API
- 背景色已由框架注入为 #0f1117，不要再自己设 camera.background_color
- 中文字体请用 \`manim_theme.FONT_CJK_SERIF\`，别用 serif 兜底`;

const SYSTEM = `你是一位用 Manim 制作教学动画的工程师。

你会拿到：一个知识点的口播稿、词级时间戳、以及这个动画要达成什么目的。
你要写一个**自包含的 Manim 场景类**，让动画严格跟着口播节奏走。

${API_RULES}

## 节奏控制：这是本任务的核心

用 \`manim_sync.narrator\`。它提供：
- \`n.wait_for(self, "关键词")\` —— 等到旁白念完该词再继续下一步动画
- \`n.wait_until(self, "关键词")\` —— 等到旁白开始念该词
- \`n.pad_to_audio(self, min_tail=0.5)\` —— 收尾，补齐到音频结束
- \`n.remaining(self)\` —— 距音频结束还剩多少秒

写法：
\`\`\`python
from manim import *
import numpy as np
from manim_sync import narrator
from manim_theme import ACCENT, ACCENT_WARM, CjkTexTemplate, FONT_CJK_SERIF


class YourScene(Scene):
    def construct(self):
        n = narrator()
        # ... 建对象 ...
        self.play(Create(x), run_time=1.0)
        n.wait_for(self, "平方和")     # 念到才动
        self.play(Write(eq), run_time=0.8)
        n.pad_to_audio(self)          # 收尾
\`\`\`

**只用列出的锚点**，它们是从口播里解析出来的真实时间点。
自己编一个不在列表里的词，\`wait_for\` 会找不到并忽略它（不会崩，但会错位）。

## 布局纪律（最容易出问题的地方）

- 三角形/图形用**显式坐标** \`Polygon(A, B, C)\` 构造，别用 \`Triangle()\`
  再旋转 —— 那样直角顶点的位置不可控，画直角标记会很难看
- 给斜线旁的标签定位时，**不能用** \`next_to(line, RIGHT)\`（对斜线而言
  RIGHT 指的是包围盒右边缘，会飘到画面中间）。正确做法是沿法线外推：
  \`outward = mid - centroid; label.move_to(mid + outward/norm*0.55)\`
- 中文句子普遍偏宽，放整行时用 \`scale_to_fit_width(11)\` 之内

## 输出

只输出一个 Python 代码块，不要任何解释文字。代码必须：
1. 类名与要求的 className 完全一致
2. 只依赖 \`manim\` / \`numpy\` / \`manim_sync\` / \`manim_theme\`
3. 不读写文件、不联网`;

const anchorTimes = (beat: Beat): string =>
  beat.words
    ?.map((w) => `  ${w.start.toFixed(2)}s  「${w.text}」`)
    .join("\n") || "  （无时间戳信息）";

/** 挑出真正值得 wait_for 的词：长一点的实词，太短的词会抖 */
const pickAnchors = (beat: Beat): string[] => {
  const uniq = new Set<string>();
  for (const w of beat.words ?? []) {
    if (w.text.length >= 2 && w.text.length <= 6) uniq.add(w.text);
  }
  return Array.from(uniq).slice(0, 14);
};

// ---- 快速渲染验证 ----

/**
 * 从 Manim 的 stderr 里提取「对人有用」的错误。
 *
 * Manim 用 rich 输出，日志里混着三种东西，按优先级：
 *   1. Manim logger 的 `ERROR  <说明>  <file>:<line>`（含缩进续写）——信息最准
 *   2. Python 异常行（`NameError: ...`）——API 写错时只有这里有
 *   3. rich 的 traceback 框——纯噪声，全是 `in render` / `in construct`
 *
 * 这段文本会原样喂回给模型做修复，所以必须去掉框线和栈帧：
 * 噪声会占 token，也会把模型注意力从真正的错误原因上带走。
 */
export const extractManimError = (stderr: string): string => {
  const clean = stderr.replace(/\x1b\[[0-9;]*m/g, "");
  const rawLines = clean.split("\n");
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.replace(/^[\s│╭╰❱]+/, "").replace(/[│╭╰]+$/, "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  // ---- 1. Manim logger 的 ERROR 块（含缩进续写） ----
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(
      /^\s*(ERROR|CRITICAL)\s+(\S.*?)\s{2,}(\S+\.py:\d+)\s*$/,
    );
    if (!m) continue;
    push(`[${m[1]}] ${m[2].trim()}  (${m[3]})`);
    for (let j = i + 1; j < rawLines.length; j++) {
      const c = rawLines[j].trim();
      if (!c || /^[╭│╰❱]/.test(c)) break;
      push(c);
    }
  }

  // ---- 2. Python 异常行 + narrator 自己的警告 ----
  for (const raw of rawLines) {
    const t = raw.replace(/^[\s│╭╰❱]+/, "").trim();
    if (/^(?:[\w.]+\.)*\w*(?:Error|Exception)\b/.test(t) && !/^Traceback/.test(t)) {
      push(t.replace(/\s{2,}\d+\s+│.*$/, ""));
    } else if (t.startsWith("[manim_sync]")) {
      push(t);
    }
  }

  if (!out.length) {
    return (
      rawLines
        .slice(-30)
        .map((l) => l.replace(/^[\s│╭╰❱]+/, "").trimEnd())
        .filter((l) => l.trim() && !/^[─\s]*$/.test(l))
        .slice(-8)
        .join("\n") || "(Manim 未输出可识别的报错)"
    );
  }

  return out.join("\n");
};

// 导出以便离线测试：不依赖 LLM 就能验证「好代码通过、坏代码被拦住」
export const validateRender = (
  code: string,
  className: string,
  syncData: unknown,
): { ok: boolean; error: string } => {
  if (!fs.existsSync(MANIM_BIN)) {
    return {
      ok: false,
      error:
        `找不到 manim：${MANIM_BIN}\n`
        + `请先跑：python3 -m venv pipeline/manim-venv && `
        + `pipeline/manim-venv/bin/pip install manim`,
    };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manim-check-"));
  try {
    const sceneFile = path.join(tmp, "scene.py");
    fs.writeFileSync(sceneFile, code, "utf-8");
    fs.writeFileSync(
      path.join(tmp, "sync.json"),
      JSON.stringify(syncData),
      "utf-8",
    );

    execFileSync(
      MANIM_BIN,
      [
        "-ql", "-s", "--format=png",   // 只渲最后一帧，秒级
        "--media_dir", path.join(tmp, "media"),
        "-o", "check",
        sceneFile, className,
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: PIPELINE + path.delimiter + (process.env.PYTHONPATH ?? ""),
          MANIM_SYNC_JSON: path.join(tmp, "sync.json"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180_000,
      },
    );
    return { ok: true, error: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    // Manim 的 rich 日志（ERROR 块、LaTeX 报错）在 **stdout**，
    // 而rich traceback 框和 Python 异常行在 **stderr**。
    // 只读其一会丢掉另一半信息——曾经因此漏掉了 LaTeX 的真实原因。
    const both = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`;
    return {
      ok: false,
      error: extractManimError(both) || e.message || "未知错误",
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

// ---- 生成 / 修复 ----

const SYSTEM_REPAIR = `${SYSTEM}

## 你正在修一份渲染失败的代码

上面的报错来自实际运行。请**只输出修正后的完整代码**，不要解释。
常见原因：Manim API 名字或签名不对、LaTeX 转义有问题、内容超出帧边界。`;

const askForCode = async (
  provider: ReturnType<typeof resolveProvider>,
  beat: Beat,
  ev: VisualEvent,
  className: string,
  prevCode: string,
  prevError: string,
) => {
  const user = [
    `## 要展示的知识点`,
    ev.intent ?? "(未提供 intent，请自行判断这个视觉要表达什么)",
    ``,
    `## 本单元口播稿`,
    beat.narration,
    ``,
    `## 词级时间戳（旁白念到各词的准确时刻）`,
    anchorTimes(beat),
    ``,
    `## 优先考虑用作 wait_for 锚点的词`,
    pickAnchors(beat).map((a) => `「${a}」`).join(" "),
    ``,
    `## 要求`,
    `场景类名必须是 \`${className}\`。`,
    prevCode
      ? `\n## 上一次失败的代码\n\`\`\`python\n${prevCode}\n\`\`\`\n\n## 实际报错\n${prevError}`
      : "",
  ].join("\n");

  const text = await provider.chat([
    { role: "system", content: prevCode ? SYSTEM_REPAIR : SYSTEM },
    { role: "user", content: user },
  ], { temperature: prevCode ? 0.3 : 0.7, maxTokens: 4000 });

  // 抽代码块；模型有时会带上解释文字
  const fenced = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  let code = (fenced ? fenced[1] : text).trim();

  // 防御：模型偶尔不守规矩，直接输出裸代码没有 class 定义
  if (!code.includes(`class ${className}`)) {
    throw new Error(`模型输出里没有 class ${className}，可能被截断或跑偏`);
  }
  return code;
};

// ---- main ----

const main = async () => {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const lessonArg = argv.find((a) => !a.startsWith("--"));
  // argv.indexOf 找不到时返回 -1，直接用会取到 argv[0]（lesson 路径本身）
  const attemptsRaw = arg("--attempts");
  const maxAttempts = attemptsRaw && /^\d+$/.test(attemptsRaw) ? Number(attemptsRaw) : 3;
  const retryFailed = argv.includes("--retry-failed");
  const providerSpec = arg("--provider");

  if (!lessonArg) {
    console.error(
      "用法：npx tsx pipeline/gen-manim.ts <时间轴.json> "
      + "[--attempts 3] [--retry-failed] [--provider 厂商:模型]\n"
      + "注意：输入必须是 edge_timeline.py 产出的时间轴，不是 lesson.json",
    );
    process.exit(1);
  }

  const lessonPath = path.resolve(lessonArg);
  if (!fs.existsSync(lessonPath)) {
    console.error(
      `❌ 找不到文件: ${lessonPath}\n`
      + `   提示：gen-manim 需要 edge_timeline.py 产出的时间轴（因为要用词级时间戳选锚点），`
      + `不是手写的 lesson.json。先跑：npm run lesson:timeline -- <lesson.json> -o tmp/t.json`,
    );
    process.exit(1);
  }

  const lesson = JSON.parse(fs.readFileSync(lessonPath, "utf-8"));
  const provider = resolveProvider(providerSpec);

  // 收集待生成的 manim 事件
  type Job = { si: number; bi: number; vi: number; ev: VisualEvent; beat: Beat };
  const jobs: Job[] = [];

  lesson.sections.forEach((sec: any, si: number) => {
    sec.beats.forEach((b: Beat, bi: number) => {
      (b.visuals ?? []).forEach((ev: VisualEvent, vi: number) => {
        if (ev.type !== "manim") return;
        if (ev.sceneCode && !retryFailed) return;
        jobs.push({ si, bi, vi, ev, beat: b });
      });
    });
  });

  if (!jobs.length) {
    console.log("ℹ️  没有需要生成代码的 manim 事件（已生成过，或该课不含 manim）");
    return;
  }

  console.log(`🎬 待生成 ${jobs.length} 个 Manim 场景`);
  console.log(`   模型: ${provider.name}  最多尝试 ${maxAttempts} 轮\n`);

  let ok = 0;
  const failed: string[] = [];

  for (const { si, bi, vi, ev, beat } of jobs) {
    const className = ev.className || `Scene${si}${bi}${vi}`;
    const where = `第${si + 1}节/单元${bi + 1}`;
    const id = ev.id || `s${si}b${bi}e${vi}`;

    process.stdout.write(`▶ ${id} (${className}) … `);

    let code = "";
    let lastErr = "";
    let done = false;

    for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
      try {
        code = await askForCode(provider, beat, ev, className,
          attempt === 1 ? "" : code, lastErr);
      } catch (err) {
        lastErr = (err as Error).message;
        console.log(`\n   ✗ 第${attempt}轮生成失败: ${lastErr.split("\n")[0]}`);
        continue;
      }

      const check = validateRender(code, className, {
        // 校验阶段还没跑 TTS，给个估的时长即可（wait_for 会退化为不等待）
        durationSec: 12,
        words: beat.words ?? [],
        narration: beat.narration,
      });

      if (check.ok) {
        ev.sceneCode = code;
        ev.className = className;
        ok++;
        console.log(`✓ 通过（${attempt} 轮）`);
        done = true;
      } else {
        lastErr = check.error;
        console.log(`\n   ↻ 第${attempt}轮渲染失败:\n${indent(check.error, 6)}`);
      }
    }

    if (!done) {
      // 把失败现场留在文件里，人工接着改比重新生成划算
      ev.sceneCode = code || undefined;
      ev.className = className;
      ev.generateError = lastErr;
      failed.push(`${id} — ${lastErr.split("\n")[0]}`);
    }
  }

  fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), "utf-8");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`成功 ${ok} / ${jobs.length}`);
  if (failed.length) {
    console.log(`\n❌ 失败 ${failed.length} 个（sceneCode 和报错已写回 JSON，可人工修）：`);
    failed.forEach((f) => console.log(`   ${f}`));
    console.log("\n修好后重跑：npx tsx pipeline/gen-manim.ts "
      + `${path.basename(lessonPath)} --retry-failed`);
    process.exit(1);
  }
  console.log(`\n✅ 已写入 ${lessonPath}`);
  console.log("下一步：");
  console.log("下一步：");
  console.log(`   npm run lesson:manim -- ${path.basename(lessonPath)} --quality h`);
};

const indent = (s: string, n: number) =>
  s.split("\n").map((l) => " ".repeat(n) + l).join("\n");

// 加守卫：被 import 时不自动执行，这样校验函数可以离线测试
if (require.main === module) {
  main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}