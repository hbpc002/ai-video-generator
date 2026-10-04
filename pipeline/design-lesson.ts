/**
 * 阶段①：课程设计。
 *
 * 只产出「大纲 + 旁白 + 每个 beat 该放什么视觉」，**绝不产出代码**。
 * 这是刻意的分工 —— Manim 代码放在阶段②单独生成，让代码不以
 * 转义字符串的形式嵌在 JSON 里（模型对 `r"\text{}"` 这类内容
 * 的转义处理极容易出错，而这类 bug 极难定位）。
 *
 * 用法：
 *   npx tsx pipeline/design-lesson.ts \
 *     --topic "勾股定理" --grade 初中 --beats 6 \
 *     --provider gemini:gemini-2.5-flash \
 *     --out scripts/lesson-勾股定理.json
 *
 *   # 附带教材片段
 *   npx tsx pipeline/design-lesson.ts --material 课本第3章.txt --topic 勾股定理
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { chatJson, listProviders, resolveProvider } from "../backend/src/llm";
// 校验逻辑放在 backend/src/lesson/，web 编辑器复用同一份，避免两套规则不一致
import { validate, type Issue } from "../backend/src/lesson/validate";

// pipeline 用系统 python（edge-tts）和项目内 manim venv，这里只需要 node
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ---- 输出 schema ----
// 刻意保持扁平、字段少：schema 越复杂，模型填错字段的概率越高。
const LESSON_SCHEMA = {
  type: "object",
  required: ["title", "learningObjectives", "sections"],
  properties: {
    title: { type: "string", description: "课程标题，不超过 16 字" },
    learningObjectives: {
      type: "array",
      description: "本课学习目标，3-4 条，每条一句话",
      items: { type: "string" },
    },
    sections: {
      type: "array",
      description: "章节划分",
      items: {
        type: "object",
        required: ["title", "beats"],
        properties: {
          title: { type: "string", description: "章节标题" },
          beats: {
            type: "array",
            description: "讲解单元",
            items: {
              type: "object",
              required: ["narration", "visualPlan"],
              properties: {
                narration: {
                  type: "string",
                  description:
                    "这个单元的完整口播稿。只写「要讲的话」，不要写「现在显示公式」这类指令。",
                },
                visualPlan: {
                  type: "array",
                  description:
                    "该单元要叠加的视觉层，按出现先后排列。没有视觉就返回空数组。",
                  items: {
                    type: "object",
                    required: ["type", "at", "intent"],
                    properties: {
                      type: {
                        type: "string",
                        enum: [
                          "manim", "equation", "board", "diagram",
                          "list", "highlight", "image",
                        ],
                        description:
                          "manim=几何/函数/公式推导（需代码）;"
                          + "equation=单条公式;board=板书文字;"
                          + "diagram=示意图;list=要点列表;highlight=聚光强调;image=配图",
                      },
                      at: {
                        type: "string",
                        description:
                          "锚点关键词，必须是 narration 里**原样连续出现**的 2-6 字。"
                          + "视觉在这一词被念到时出现。留空字符串表示从开头就显示。",
                      },
                      intent: {
                        type: "string",
                        description:
                          "这个视觉要帮学生理解什么（一句话）。阶段②会照此写代码。",
                      },
                      latex: { type: "string", description: "type=equation 时的公式" },
                      text: { type: "string", description: "type=board 时的板书内容" },
                      items: {
                        type: "array",
                        items: { type: "string" },
                        description: "type=list 时的要点，2-4 条",
                      },
                    },
                  },
                },
                quiz: {
                  type: "object",
                  required: ["question", "options"],
                  properties: {
                    question: { type: "string" },
                    options: {
                      type: "array",
                      items: { type: "string" },
                      description: "3 个选项",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `你是一名资深中小学教师，同时懂教学设计和视频分镜。

你要设计一节 AI 视频课，产出：讲解大纲、每个单元的口播稿、以及每个单元该配什么视觉。

## 硬性规则

1. **narration 是纯口播稿**。只写教师要说的话。不要出现"我们来看图""公式如下"
   这类指示性文字——画面会自己呈现，旁白只需讲内容和道理。
2. **at 必须原样出现在 narration 里**。这是画面触发的锚点，模型会按
   "旁白念到这个词时让画面动起来"来对齐。锚点取 2-6 字的实词
   （如"平方和""斜边"），不要取标点，也不要跨句。
3. **visualPlan 按时间先后排列**，与 narration 的叙述顺序一致。
4. **一条 beat 只讲一件事**，口播 40-90 字。宁可多分几个 beat，
   也不要一个 beat 塞满全部内容。
5. 视觉服务于理解，不要为了装饰而加。几何/函数/公式推导用 manim；
   语文历史这类以文字和情境为主的，用 board 或 list 就够。

## 教学要求

- 先给学习目标，再设计内容，目标是可检验的（"能说出…""能算出…"）
- 抽象概念先给具体例子，再上一般结论
- 每个知识点后安排一道小测题检验是否真的懂了`;

const buildUserPrompt = (opts: {
  topic: string;
  grade: string;
  beats: number;
  material?: string;
}) => {
  const lines = [
    `课题：${opts.topic}`,
    `学段：${opts.grade}`,
    `讲解单元总数：约 ${opts.beats} 个`,
  ];
  if (opts.material) {
    lines.push(
      "",
      "以下是教材/资料片段，内容要以此为准，不要编造超出资料的信息：",
      "<<<",
      opts.material.slice(0, 8000),
      ">>>",
    );
  }
  lines.push("", "请输出课程设计。");
  return lines.join("\n");
};

// ---- main ----

const main = async () => {
  const argv = process.argv.slice(2);
  const arg = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const flag = (name: string) => argv.includes(`--${name}`);

  if (flag("list")) {
    console.log("可用 provider：\n");
    for (const r of listProviders()) {
      console.log(`  ${r.ready ? "✅" : "⬜"} ${r.spec.padEnd(28)} ${r.note}`);
    }
    return;
  }

  const topic = arg("topic");
  const materialPath = arg("material");
  const grade = arg("grade", "初中")!;
  const beatCount = Number(arg("beats", "6"));
  const providerSpec = arg("provider");
  const out = arg("out");

  if (!topic && !materialPath) {
    console.error(
      "用法：npx tsx pipeline/design-lesson.ts --topic <课题> "
      + "[--grade 初中] [--beats 6] [--material 资料.txt] [--provider 厂商:模型] [--out 输出.json]\n"
      + "     npx tsx pipeline/design-lesson.ts --list   # 查看可用 provider",
    );
    process.exit(1);
  }

  let material: string | undefined;
  if (materialPath) {
    const p = path.resolve(materialPath);
    if (!fs.existsSync(p)) {
      console.error(`❌ 找不到资料文件: ${p}`);
      process.exit(1);
    }
    material = fs.readFileSync(p, "utf-8");
  }

  const provider = resolveProvider(providerSpec);
  const heading = topic ?? (materialPath ? path.basename(materialPath!) : "未命名");

  console.log(`📚 课题: ${heading}`);
  console.log(`   学段: ${grade}  单元数: ~${beatCount}`);
  console.log(`   模型: ${provider.name}\n`);

  const raw = await chatJson(
    provider,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: buildUserPrompt({
          topic: heading, grade, beats: beatCount, material,
        }),
      },
    ],
    { jsonSchema: LESSON_SCHEMA as unknown as Record<string, unknown>, temperature: 0.8 },
  );

  const issues = validate(raw);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  console.log(`✅ 模型产出: ${JSON.stringify(raw).length} 字符`);

  if (errors.length) {
    console.error(`\n❌ 校验未通过，${errors.length} 个错误：`);
    errors.forEach((i) => console.error(`   ${i.where} — ${i.message}`));
    console.error("\n原始输出已存到 tmp/design-lesson.raw.json，可查看后重试。");
    fs.mkdirSync(path.resolve(__dirname, "../tmp"), { recursive: true });
    fs.writeFileSync(
      path.resolve(__dirname, "../tmp/design-lesson.raw.json"),
      JSON.stringify(raw, null, 2),
    );
    process.exit(1);
  }
  if (warns.length) {
    console.warn(`\n⚠️  ${warns.length} 条提醒：`);
    warns.forEach((i) => console.warn(`   ${i.where} — ${i.message}`));
  }

  // ---- 落成 pipeline 消费的形状 ----
  // validate() 已确认结构完整，这里收窄成具体类型
  const design = raw as {
    title: string;
    learningObjectives: string[];
    sections: any[];
  };

  const lesson = {
    title: design.title,
    fps: 30, width: 1920, height: 1080, style: "lesson",
    learningObjectives: design.learningObjectives,
    sections: design.sections.map((sec: any) => ({
      title: sec.title,
      beats: sec.beats.map((b: any) => ({
        narration: b.narration,
        layout: b.visualPlan?.length ? "auto" : "center",
        ...(b.visualPlan?.length
          ? {
              visuals: b.visualPlan.map((v: any) => ({
                type: v.type,
                ...(v.at ? { at: v.at } : {}),
                ...(v.latex ? { latex: v.latex } : {}),
                ...(v.text ? { text: v.text } : {}),
                ...(v.items ? { items: v.items } : {}),
                // intent 先留在 JSON 里：阶段②要用它写代码，
                // 人来复核时也能看懂这个视觉为什么存在
                intent: v.intent,
              })),
            }
          : {}),
        ...(b.quiz ? { quiz: b.quiz } : {}),
      })),
    })),
  };

  const outPath = path.resolve(out ?? `scripts/lesson-${heading}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(lesson, null, 2), "utf-8");

  const totalBeats = lesson.sections.reduce((a: number, s: any) => a + s.beats.length, 0);
  const manimCount = lesson.sections
    .flatMap((s: any) => s.beats)
    .flatMap((b: any) => b.visuals ?? [])
    .filter((v: any) => v.type === "manim").length;

  console.log(`\n✅ 已写入 ${outPath}`);
  console.log(`   ${lesson.sections.length} 节 / ${totalBeats} 单元`
    + ` / 需生成 Manim 代码 ${manimCount} 处`);
  console.log("\n下一步：");
  console.log("   npx tsx pipeline/gen-manim.ts " + outPath
    + "   # 补全 manim 场景代码（带渲染自愈）");
  console.log("   npm run lesson:timeline -- " + outPath + " -o tmp/lesson.timeline.json");
};

// 加守卫：被 import 时不自动执行，这样校验函数可以离线测试
if (require.main === module) {
  main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}