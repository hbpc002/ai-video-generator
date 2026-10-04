// 把 pipeline/edge_timeline.py 产出的时间轴包成 Remotion props 文件。
//
// 用法:
//   npm run lesson:timeline -- scripts/lesson-xxx.json -o tmp/lesson.timeline.json
//   npm run lesson:props    -- tmp/lesson.timeline.json video/lesson-props.json
//   npm run lesson:render   -- out/lesson.mp4 --props=lesson-props.json
import fs from "fs";
import path from "path";

const [, , timelineArg, propsArg] = process.argv;
const timelinePath = timelineArg ?? "tmp/lesson.timeline.json";
const propsPath = propsArg ?? "video/lesson-props.json";

if (!fs.existsSync(timelinePath)) {
  console.error(`❌ 找不到时间轴文件: ${timelinePath}`);
  console.error("   先跑: npm run lesson:timeline -- <lesson.json> -o tmp/lesson.timeline.json");
  process.exit(1);
}

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));

// preflight：锚点没命中 / 越过音频长度，直接拦下不让渲出空洞画面
const errors = (timeline.warnings ?? []).filter(
  (w: { level: string }) => w.level === "error",
);
if (errors.length > 0) {
  console.error(`❌ preflight 未通过，${errors.length} 个问题：`);
  for (const w of errors) {
    console.error(
      `   section ${w.section}/beat ${w.beat} ${w.anchor ?? ""} ${w.reason}` +
        (w.hint ? `\n      ${w.hint}` : ""),
    );
  }
  process.exit(1);
}

fs.mkdirSync(path.dirname(propsPath), { recursive: true });
fs.writeFileSync(propsPath, JSON.stringify({ timeline }, null, 0), "utf-8");

const beats = timeline.sections.flatMap((s: { beats: unknown[] }) => s.beats);
const audioSec = beats.reduce(
  (a: number, b: { durationSec: number }) => a + b.durationSec,
  0,
);
console.log(`✅ props 已写入 ${propsPath}`);
console.log(`   ${timeline.sections.length} 节 / ${beats.length} beat /旁白 ${audioSec.toFixed(1)}s`);