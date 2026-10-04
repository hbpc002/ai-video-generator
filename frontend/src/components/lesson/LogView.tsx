import React, { useEffect, useRef } from "react";
import type { LessonJob } from "../../api/client";

const STEP_LABEL: Record<string, string> = {
  queued: "排队中",
  design: "生成课程设计",
  "manim-code": "生成 Manim 代码",
  timeline: "生成旁白与时间戳",
  "manim-render": "渲染 Manim 片段",
  props: "校验与合成参数",
  remotion: "Remotion 合成",
  finished: "完成",
};

/** 流水线日志。Manim 自愈循环的报错全在这里，所以要能滚动看。 */
export const LogView: React.FC<{ logs: string[]; height?: string }> = ({
  logs,
  height = "160px",
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={ref}
      className="bg-black/70 border border-gray-800 rounded p-2 overflow-auto font-mono text-[11px] leading-relaxed"
      style={{ height }}
    >
      {logs.length === 0 ? (
        <span className="text-gray-600">等待输出…</span>
      ) : (
        logs.map((l, i) => (
          <div
            key={i}
            className={
              l.startsWith("$") ? "text-blue-400"
                : l.includes("❌") || l.includes("✗") ? "text-red-400"
                : l.includes("⚠") ? "text-amber-400"
                : l.includes("✅") || l.includes("✓") ? "text-emerald-400"
                : "text-gray-400"
            }
          >
            {l}
          </div>
        ))
      )}
    </div>
  );
};

export const JobProgress: React.FC<{ job: LessonJob | null }> = ({ job }) => {
  if (!job) return null;
  const color =
    job.status === "done" ? "bg-emerald-500"
      : job.status === "error" ? "bg-red-500" : "bg-blue-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-300">
          {STEP_LABEL[job.step] ?? job.step}
          {job.status === "running" ? (
            <span className="text-blue-400"> ·进行中</span>
          ) : job.status === "done" ? (
            <span className="text-emerald-400"> ·完成</span>
          ) : (
            <span className="text-red-400"> ·失败</span>
          )}
        </span>
        <span className="font-mono text-gray-500">{job.progress}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${job.progress}%` }}
        />
      </div>
      {job.error ? <div className="text-xs text-red-400">{job.error}</div> : null}
    </div>
  );
};