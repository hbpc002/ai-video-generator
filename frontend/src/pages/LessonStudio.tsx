import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getLessonJob,
  listLessons,
  listOutputs,
  listProviders,
  loadLesson,
  saveLesson,
  startBuild,
  startDesign,
  type LessonDoc,
  type LessonFileInfo,
  type LessonIssue,
  type LessonJob,
  type ProviderView,
} from "../api/client";
import { BeatEditor } from "../components/lesson/BeatEditor";
import { JobProgress, LogView } from "../components/lesson/LogView";

const GRADES = ["小学", "初中", "高中", "大学"];

/** 默认课：没 key 也能立刻体验编辑器和出片流程 */
const STARTER: LessonDoc = {
  title: "未命名课程",
  fps: 30, width: 1920, height: 1080, style: "lesson",
  sections: [{
    title: "第一节",
    beats: [{
      narration: "在这里写下这一单元的口播稿。旁白只讲内容，画面由视觉层自己呈现。",
      visuals: [{ type: "board", at: "口播稿", intent: "点明本节主题", text: "主题" }],
    }],
  }],
};

export default function LessonStudio() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [files, setFiles] = useState<LessonFileInfo[]>([]);
  const [videos, setVideos] = useState<{ name: string; sizeMB: number }[]>([]);

  const [fileName, setFileName] = useState<string>("");
  const [lesson, setLesson] = useState<LessonDoc | null>(null);
  const [issues, setIssues] = useState<LessonIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string>("");

  const [provider, setProvider] = useState("");
  const [job, setJob] = useState<LessonJob | null>(null);

  // ---- 设计表单 ----
  const [topic, setTopic] = useState("");
  const [grade, setGrade] = useState("初中");
  const [beatCount, setBeatCount] = useState(4);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  }, []);

  // ---- 初始加载 ----
  useEffect(() => {
    void (async () => {
      try {
        const [p, f, v] = await Promise.all([listProviders(), listLessons(), listOutputs()]);
        setProviders(p.providers);
        setFiles(f);
        setVideos(v);
        // 默认选第一个「可用厂商 + 启用模型」的组合
        const usable = p.providers.find(
          (x) => x.enabled && x.status.ready && x.models.some((m) => m.enabled),
        );
        if (usable) setProvider(`${usable.vendor}:${usable.models.find((m) => m.enabled)!.id}`);

        if (f.length) {
          const first = await loadLesson(f[0].name);
          setFileName(f[0].name);
          setLesson(first.lesson);
          setIssues(first.issues);
        } else {
          setLesson(STARTER);
          setFileName("lesson-new.json");
        }
      } catch (e) {
        flash(`加载失败：${(e as Error).message}`);
      }
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [flash]);

  // ---- 作业轮询 ----
  const track = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const j = await getLessonJob(jobId);
        setJob(j);
        if (j.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;

          if (j.status === "done") {
            const [f, v] = await Promise.all([listLessons(), listOutputs()]);
            setFiles(f);
            setVideos(v);
            if (j.lessonPath) {
              const nm = j.lessonPath.split("/").pop()!;
              const loaded = await loadLesson(nm);
              setFileName(nm);
              setLesson(loaded.lesson);
              setIssues(loaded.issues);
              setDirty(false);
            }
            flash("完成");
          } else {
            flash("失败，详见日志");
          }
        }
      } catch {
        /* 轮询失败下次再试 */
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 1500);
  }, [flash]);

  const busy = job?.status === "running";

  // ---- ① 课程设计 ----
  const handleDesign = async () => {
    if (!topic.trim()) return flash("请先填课题");
    try {
      const { jobId } = await startDesign({
        topic: topic.trim(), grade, beats: beatCount, provider,
      });
      track(jobId);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // ---- ② 保存 ----
  const handleSave = async () => {
    if (!lesson) return;
    try {
      const r = await saveLesson(fileName, lesson);
      setIssues(r.issues);
      setDirty(false);
      flash(r.errors ? `已保存，但有 ${r.errors} 个错误待修` : "已保存");
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // ---- ③ 完整出片 ----
  const handleBuild = async () => {
    if (!lesson) return flash("没有可构建的课程");
    const errs = issues.filter((i) => i.level === "error");
    if (errs.length) {
      return flash(`有 ${errs.length} 个错误，先修好再出片（下方已标红）`);
    }
    if (dirty) await handleSave();
    try {
      const { jobId } = await startBuild({
        name: fileName, lesson: lesson as LessonDoc, provider,
      });
      track(jobId);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const openFile = async (name: string) => {
    if (dirty && !confirm("当前修改未保存，确定切换？")) return;
    try {
      const r = await loadLesson(name);
      setFileName(name);
      setLesson(r.lesson);
      setIssues(r.issues);
      setDirty(false);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const errCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warn").length;
  // 选择器按「模型」列，而不是厂商 —— 只列厂商已启用 + 模型已启用 + 密钥就绪的
  const modelOptions = providers.flatMap((pv) => {
    if (!pv.enabled || !pv.status.ready) return [];
    return pv.models
      .filter((m) => m.enabled)
      .map((m) => ({
        spec: `${pv.vendor}:${m.id}`,
        label: `${pv.name} · ${m.id}`,
      }));
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {toast ? (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 border border-gray-700
                        rounded px-3 py-2 text-sm shadow-lg">
          {toast}
        </div>
      ) : null}

      {/* ---------- Provider 状态 ---------- */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-200">模型</h2>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">（未选择）</option>
            {modelOptions.map((o) => (
              <option key={o.spec} value={o.spec}>{o.label}</option>
            ))}
          </select>
        </div>
        {modelOptions.length === 0 ? (
          <p className="text-xs text-amber-400">
            还没有配置任何 LLM key。去 <code className="text-gray-300">.env</code> 加一行
            （如 <code className="text-gray-300">DEEPSEEK_API_KEY=sk-...</code>）后重启后端。
            没有 key 也能用：手写或载入下面的课程 JSON，直接点「保存并出片」。
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {providers.map((pv) => (
              <span
                key={pv.id}
                title={`${pv.kind} · ${pv.status.note}`}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  !pv.enabled ? "bg-gray-800 text-gray-600 line-through"
                    : pv.status.ready ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-gray-800 text-gray-500"}`}
              >
                {!pv.enabled ? "⏸" : pv.status.ready ? "✅" : "⬜"} {pv.name}
                <span className="opacity-60">
                  {pv.models.filter((m) => m.enabled).length}/{pv.models.length}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ---------- ① 课程设计 ---------- */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-200 mb-3">① 生成课程设计</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] items-end">
          <label className="block">
            <span className="text-xs text-gray-500">课题</span>
            <input
              className="w-full mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
              placeholder="如：勾股定理 / 七步成诗"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">学段</span>
            <select
              className="block mt-1 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            >
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">单元数</span>
            <input
              type="number" min={1} max={12}
              className="block mt-1 w-16 bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
              value={beatCount}
              onChange={(e) => setBeatCount(Number(e.target.value))}
            />
          </label>
          <button
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm
                       disabled:opacity-40 whitespace-nowrap"
            disabled={busy || modelOptions.length === 0}
            onClick={handleDesign}
          >
            生成设计
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          建议先用 3-4 个单元试跑，确认口播和锚点质量后再上规模。
        </p>
      </section>

      {/* ---------- ② 编辑 ---------- */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-200">② 编辑课程</h2>
          <select
            className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs"
            value={fileName}
            onChange={(e) => void openFile(e.target.value)}
          >
            {files.length === 0 ? <option value={fileName}>{fileName}</option> : null}
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.title}（{f.stats?.beats ?? 0} 单元）
                {f.issues ? ` ⚠${f.issues}` : ""}
              </option>
            ))}
          </select>
          <input
            className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs w-40"
            value={fileName}
            onChange={(e) => { setFileName(e.target.value); setDirty(true); }}
          />
          {lesson ? (
            <input
              className="bg-transparent border-b border-gray-700 focus:border-blue-500
                         outline-none text-base font-semibold flex-1 min-w-40"
              value={lesson.title}
              onChange={(e) => { setLesson({ ...lesson, title: e.target.value }); setDirty(true); }}
            />
          ) : null}
          <button
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs disabled:opacity-40"
            disabled={!lesson || busy}
            onClick={handleSave}
          >
            保存
          </button>
          <span className="text-xs text-gray-500">
            {dirty ? "未保存" : ""}
          </span>
        </div>

        {errCount || warnCount ? (
          <div className="mb-3 text-xs space-y-0.5">
            {errCount ? (
              <div className="text-red-400">{errCount} 个错误必须修（否则无法出片）</div>
            ) : null}
            {warnCount ? <div className="text-amber-400">{warnCount} 条提醒</div> : null}
          </div>
        ) : lesson ? (
          <div className="mb-3 text-xs text-emerald-400">校验通过</div>
        ) : null}

        {lesson ? (
          <BeatEditor
            lesson={lesson}
            issues={issues}
            onChange={(next) => { setLesson(next); setDirty(true); }}
          />
        ) : (
          <div className="text-sm text-gray-500">载入中…</div>
        )}
      </section>

      {/* ---------- ③ 出片 ---------- */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-200 mb-3">③ 出片</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm
                       disabled:opacity-40"
            disabled={!lesson || busy || errCount > 0}
            onClick={handleBuild}
          >
            保存并出片
          </button>
          {errCount > 0 ? (
            <span className="text-xs text-red-400">先修掉 {errCount} 个错误</span>
          ) : null}
          {lesson ? (
            <span className="text-xs text-gray-500">
              {lesson.sections.length} 节 /{" "}
              {lesson.sections.reduce((a, s) => a + s.beats.length, 0)} 单元 /{" "}
              {lesson.sections.reduce(
                (a, s) => a + s.beats.reduce((b, x) => b + (x.visuals?.length ?? 0), 0), 0,
              )} 视觉
            </span>
          ) : null}
        </div>

        {job ? (
          <div className="mt-3 space-y-2">
            <JobProgress job={job} />
            <LogView logs={job.logs} />
            {job.videoUrl ? (
              <video
                className="w-full rounded border border-gray-800 mt-2"
                src={job.videoUrl}
                controls
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---------- 已有成片 ---------- */}
      {videos.length ? (
        <section className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-200 mb-2">已有成片</h2>
          <div className="flex flex-wrap gap-1.5">
            {videos.map((v) => (
              <a
                key={v.name}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                href={`/lesson-videos/${v.name}`}
                target="_blank"
                rel="noreferrer"
              >
                {v.name} · {v.sizeMB}MB
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}