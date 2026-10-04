import { Router } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { listProviders } from "../llm";
import { statsOf, validate } from "../lesson/validate";
import type {
  LessonDoc,
  LessonJob,
  LessonJobStep,
} from "../lesson/types";

// 项目根：backend/src/routes → 上三层
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = path.join(ROOT, "scripts");
const TMP = path.join(ROOT, "tmp");
const VIDEO_OUT = path.join(ROOT, "video", "out");
const MANIM_BIN =
  process.env.MANIM_BIN || path.join(ROOT, "pipeline", "manim-venv", "bin", "manim");

const router = Router();

// ---- 作业表（进程内，够用；重启即丢） ----
const jobs = new Map<string, LessonJob>();
const MAX_LOG_LINES = 400;

const setStep = (job: LessonJob, step: LessonJobStep, progress: number) => {
  job.step = step;
  job.progress = progress;
};

/**
 * Remotion 每渲一帧就打一行进度（1253 帧 = 1253 行），
 * 不滤掉的话日志会被彻底冲掉，真正有用的 TTS / preflight / Manim 报错
 * 全被挤出保留窗口。
 */
const NOISE = [
  /^Rendered \d+\/\d+/,
  /^Encoded \d+\/\d+/,
  /^Bundled \d+\/\d+/,
  /^\s*$/,
];

const pushLog = (job: LessonJob, line: string) => {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  if (NOISE.some((re) => re.test(clean))) return;
  job.logs.push(clean);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
};

interface RunOpts {
  job: LessonJob;
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

const run = (opts: RunOpts): Promise<number> =>
  new Promise((resolve) => {
    const { job, cmd, args } = opts;
    pushLog(job, `$ ${cmd} ${args.join(" ")}`);

    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
    });

    const onChunk = (buf: Buffer) => {
      for (const line of buf.toString().split("\n")) pushLog(job, line);
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err) => {
      pushLog(job, `❌ 进程启动失败: ${err.message}`);
      resolve(-1);
    });
    child.on("close", (code) => resolve(code ?? -1));
  });

const PYTHON = process.env.PYTHON_BIN || "python3";

/** 跑一个 pipeline 里的 Python 脚本。脚本路径必须是 argv[0]。 */
const runPython = (
  job: LessonJob,
  script: string,
  args: string[],
): Promise<number> => run({ job, cmd: PYTHON, args: [script, ...args] });

// ---- provider 列表 ----
router.get("/providers", (_req, res) => {
  res.json({ providers: listProviders() });
});

// ---- lesson 文件读写 ----
const safeName = (name: string) => path.basename(name).replace(/[^一-龥\w.-]/g, "");

const readLesson = (file: string): LessonDoc | null => {
  const p = path.join(SCRIPTS, safeName(file));
  if (!p.endsWith(".json") || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as LessonDoc;
  } catch {
    return null;
  }
};

router.get("/files", (_req, res) => {
  if (!fs.existsSync(SCRIPTS)) return res.json({ files: [] });
  const files = fs
    .readdirSync(SCRIPTS)
    .filter((f) => f.startsWith("lesson-") && f.endsWith(".json"))
    .map((f) => {
      const doc = readLesson(f);
      return {
        name: f,
        title: doc?.title ?? f.replace(/^lesson-|\.json$/g, ""),
        stats: doc ? statsOf(doc) : null,
        issues: doc ? validate(doc).length : 0,
      };
    });
  res.json({ files });
});

router.get("/file", (req, res) => {
  const doc = readLesson(String(req.query.name ?? ""));
  if (!doc) return res.status(404).json({ error: "lesson 不存在" });
  res.json({
    lesson: doc,
    issues: validate(doc),
    stats: statsOf(doc),
  });
});

/** 保存编辑后的 lesson —— 编辑器的主要写入口 */
router.put("/file", (req, res) => {
  const name = safeName(String(req.body?.name ?? ""));
  if (!name.endsWith(".json")) {
    return res.status(400).json({ error: "文件名不合法" });
  }
  const lesson = req.body?.lesson as LessonDoc;
  if (!lesson?.sections) {
    return res.status(400).json({ error: "lesson 结构不完整" });
  }

  const issues = validate(lesson);
  // 编辑过程允许带 error 保存（比如先改口播再补锚点），
  // 但要如实返回，让前端标红
  const p = path.join(SCRIPTS, name);
  fs.mkdirSync(SCRIPTS, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(lesson, null, 2), "utf-8");
  res.json({ saved: true, issues, stats: statsOf(lesson), errors: issues.filter(i => i.level === "error").length });
});

// ---- 已渲染的成片 ----
router.get("/outputs", (_req, res) => {
  if (!fs.existsSync(VIDEO_OUT)) return res.json({ videos: [] });
  const videos = fs
    .readdirSync(VIDEO_OUT)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const st = fs.statSync(path.join(VIDEO_OUT, f));
      return { name: f, sizeMB: +(st.size / 1024 / 1024).toFixed(1), mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ videos });
});

// ---- 作业：课程设计 ----
router.post("/design", (req, res) => {
  const { topic, grade = "初中", beats = 6, provider, material, out } = req.body ?? {};
  if (!topic && !material) {
    return res.status(400).json({ error: "需要 topic 或 material" });
  }

  const job: LessonJob = {
    id: randomUUID(),
    kind: "design",
    status: "running",
    step: "queued",
    progress: 0,
    logs: [],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  setStep(job, "design", 5);

  const args = [
    path.join(ROOT, "pipeline", "design-lesson.ts"),
    ...(topic ? ["--topic", String(topic)] : []),
    "--grade", String(grade),
    "--beats", String(beats),
    ...(provider ? ["--provider", String(provider)] : []),
    "--out", path.join(SCRIPTS, safeName(String(out ?? `lesson-${topic ?? "auto"}.json`))),
  ];
  if (material) {
    const mp = path.join(TMP, `material-${Date.now()}.txt`);
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(mp, String(material), "utf-8");
    args.push("--material", mp);
  }

  void (async () => {
    job.progress = 15;
    const code = await run({
      job,
      cmd: "npx",
      args: ["tsx", ...args],
    });
    job.finishedAt = Date.now();
    if (code !== 0) {
      job.status = "error";
      job.error = "课程设计失败，详见日志";
      setStep(job, "finished", job.progress);
      return;
    }
    job.status = "done";
    job.progress = 100;
    setStep(job, "finished", 100);
    const name = safeName(String(out ?? `lesson-${topic ?? "auto"}.json`));
    job.lessonPath = `scripts/${name}`;
  })();

  res.json({ jobId: job.id });
});

/**
 * 作业：完整出片。
 *
 * 顺序里有个容易搞错的地方：**先生成时间轴再写 Manim 代码**。
 * 因为 gen-manim 要靠词级时间戳给模型列可用锚点，而时间戳来自 TTS。
 */
router.post("/build", (req, res) => {
  const { lesson, provider, quality = "h", renderManim = true } = req.body ?? {};
  if (!lesson?.title || !Array.isArray(lesson.sections)) {
    return res.status(400).json({ error: "请先提供 lesson 内容" });
  }

  const name = safeName(String(req.body?.name ?? `lesson-${lesson.title}.json`));
  const lessonPath = path.join(SCRIPTS, name);
  fs.mkdirSync(SCRIPTS, { recursive: true });
  fs.writeFileSync(lessonPath, JSON.stringify(lesson, null, 2), "utf-8");

  const stem = path.basename(name, ".json");
  const timelinePath = path.join(TMP, `${stem}.timeline.json`);

  const job: LessonJob = {
    id: randomUUID(),
    kind: "build",
    status: "running",
    step: "queued",
    progress: 0,
    logs: [],
    lessonPath: `scripts/${name}`,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      // ---- 1. TTS + 词级时间戳 ----
      setStep(job, "timeline", 10);
      let code = await runPython(
        job,
        path.join(ROOT, "pipeline", "edge_timeline.py"),
        [lessonPath, "-o", timelinePath],
      );
      if (code !== 0) throw new Error("TTS/时间轴阶段失败");

      // ---- 2. Manim 代码（自愈重试）----
      if (lesson.sections.some((s: { beats?: { visuals?: { type: string }[] }[] }) =>
        (s.beats ?? []).some((b) => (b.visuals ?? []).some((v) => v.type === "manim")))) {
        setStep(job, "manim-code", 35);
        code = await run({
          job,
          cmd: "npx",
          args: [
            "tsx", path.join(ROOT, "pipeline", "gen-manim.ts"), timelinePath,
            ...(provider ? ["--provider", provider] : []),
          ],
        });
        // 代码生成失败不阻断：非 manim 的内容照样能出片
        if (code !== 0) pushLog(job, "⚠️  Manim 代码阶段有失败，将跳过这些片段继续");
      }

      // ---- 3. Manim 片段渲染 ----
      if (renderManim && fs.existsSync(MANIM_BIN)) {
        setStep(job, "manim-render", 55);
        code = await runPython(
          job,
          path.join(ROOT, "pipeline", "render_manim.py"),
          [timelinePath, "--quality", String(quality)],
        );
        if (code !== 0) pushLog(job, "⚠️  有 Manim 片段渲染失败，相关位置会是空白");
      } else if (renderManim) {
        pushLog(job, `⚠️  未找到 manim（${MANIM_BIN}），跳过片段渲染`);
      }

      // ---- 4. preflight + props ----
      setStep(job, "props", 70);
      const propsPath = path.join(ROOT, "video", `${stem}-props.json`);
      code = await run({
        job,
        cmd: "npx",
        args: [
          "tsx", path.join(ROOT, "pipeline", "build-lesson-props.ts"),
          timelinePath, propsPath,
        ],
      });
      if (code !== 0) throw new Error("preflight 未通过，课程里有锚点或结构问题");

      // ---- 5. Remotion 合成 ----
      setStep(job, "remotion", 80);
      code = await run({
        job,
        cmd: "npx",
        args: [
          "remotion", "render", "src/index.ts", "LessonVideo",
          path.join(VIDEO_OUT, `${stem}.mp4`),
          `--props=${propsPath}`,
          "--concurrency=8",
        ],
        cwd: path.join(ROOT, "video"),
      });
      if (code !== 0) throw new Error("Remotion 渲染失败");

      const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8")) as LessonDoc;
      job.stats = statsOf(timeline);
      job.videoUrl = `/lesson-videos/${stem}.mp4`;
      job.status = "done";
      setStep(job, "finished", 100);
    } catch (err) {
      job.status = "error";
      job.error = (err as Error).message;
      setStep(job, "finished", job.progress);
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  res.json({ jobId: job.id });
});

router.get("/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "作业不存在（服务已重启？）" });
  res.json({ job });
});

export default router;