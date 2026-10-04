import React, { useMemo } from "react";
import type { Beat, LessonDoc, LessonIssue, VisualEvent, VisualType } from "../../api/client";

const TYPE_LABEL: Record<VisualType, string> = {
  manim: "Manim",
  equation: "公式",
  board: "板书",
  diagram: "图形",
  list: "要点",
  highlight: "聚光",
  image: "配图",
  video: "短片",
};

// 各类型需要哪些附加字段 —— 决定编辑器渲染哪些输入框
const NEEDS: Record<VisualType, (keyof VisualEvent)[]> = {
  manim: [],
  equation: ["latex"],
  board: ["text"],
  diagram: [],
  list: ["items"],
  highlight: [],
  image: ["imageUrl"],
  video: [],
};

const PUNCT = /[，。！？；：、,.!?;:]/g;

interface Props {
  lesson: LessonDoc;
  onChange: (next: LessonDoc) => void;
  issues: LessonIssue[];
  readOnly?: boolean;
}

/** 把 issue 按「节/单元/视觉」归位，让报错能标在对应的行上 */
const indexIssues = (issues: LessonIssue[]) => {
  const map = new Map<string, LessonIssue[]>();
  for (const i of issues) {
    const key = i.where.replace(/^第\d+节/, "S").replace(/「.*?」/, "").replace(/单元(\d+)/, "B$1");
    const list = map.get(key) ?? [];
    list.push(i);
    map.set(key, list);
  }
  return map;
};

const IssueTags: React.FC<{ items?: LessonIssue[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((i, k) => (
        <div
          key={k}
          className={`text-xs ${i.level === "error" ? "text-red-400" : "text-amber-400"}`}
        >
          {i.level === "error" ? "✕" : "⚠"} {i.message}
        </div>
      ))}
    </div>
  );
};

export const BeatEditor: React.FC<Props> = ({ lesson, onChange, issues, readOnly }) => {
  const issueMap = useMemo(() => indexIssues(issues), [issues]);
  const dis = readOnly ? true : undefined;

  const patchBeat = (
    si: number,
    bi: number,
    patch: Partial<Beat>,
  ) => {
    const sections = lesson.sections.map((s, i) =>
      i !== si ? s : {
        ...s,
        beats: s.beats.map((b, j) => (j === bi ? { ...b, ...patch } : b)),
      },
    );
    onChange({ ...lesson, sections });
  };

  const patchVisual = (
    si: number,
    bi: number,
    vi: number,
    patch: Partial<VisualEvent>,
  ) => {
    const beat = lesson.sections[si].beats[bi];
    patchBeat(si, bi, {
      visuals: (beat.visuals ?? []).map((v, j) => (j === vi ? { ...v, ...patch } : v)),
    });
  };

  const addVisual = (si: number, bi: number, type: VisualType) => {
    const beat = lesson.sections[si].beats[bi];
    patchBeat(si, bi, {
      visuals: [
        ...(beat.visuals ?? []),
        { type, at: "", intent: "", ...(type === "equation" ? { latex: "" } : {}),
          ...(type === "board" ? { text: "" } : {}),
          ...(type === "list" ? { items: [] } : {}),
          ...(type === "image" ? { imageUrl: "" } : {}) },
      ],
    });
  };

  const removeVisual = (si: number, bi: number, vi: number) => {
    const beat = lesson.sections[si].beats[bi];
    patchBeat(si, bi, { visuals: (beat.visuals ?? []).filter((_, j) => j !== vi) });
  };

  return (
    <div className="space-y-6">
      {lesson.sections.map((section, si) => (
        <div key={si}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-gray-500">第 {si + 1} 节</span>
            <input
              className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500
                         outline-none text-lg font-semibold py-1"
              value={section.title}
              disabled={dis}
              onChange={(e) => {
                const sections = lesson.sections.map((s, i) =>
                  i !== si ? s : { ...s, title: e.target.value });
                onChange({ ...lesson, sections });
              }}
            />
          </div>
          <IssueTags items={issueMap.get(`S${si}`)} />

          <div className="space-y-3 mt-3">
            {section.beats.map((beat, bi) => {
              // 锚点是否命中口播 —— 这是最常见的错误，现场给出反馈
              const spoken = (beat.narration ?? "").replace(PUNCT, "");
              const key = `S${si}B${bi + 1}`;
              return (
                <div key={bi} className="rounded-lg bg-gray-900/60 border border-gray-800 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-gray-500 mt-2 shrink-0">
                      单元 {bi + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <textarea
                        className="w-full bg-gray-950/60 border border-gray-700 rounded px-2 py-1.5
                                   text-sm leading-relaxed resize-y focus:border-blue-500 outline-none"
                        rows={Math.max(2, Math.ceil((beat.narration?.length ?? 0) / 40))}
                        value={beat.narration}
                        disabled={dis}
                        placeholder="这一单元的口播稿（旁白只讲内容，不要写「现在显示公式」这类指令）"
                        onChange={(e) => patchBeat(si, bi, { narration: e.target.value })}
                      />
                      <div className="text-right text-[10px] text-gray-600 mt-0.5">
                        {(beat.narration ?? "").replace(/\s/g, "").length} 字
                      </div>
                    </div>
                  </div>

                  <IssueTags items={issueMap.get(key)} />

                  {/* ---- 视觉层 ---- */}
                  <div className="mt-3 space-y-2">
                    {(beat.visuals ?? []).map((v, vi) => {
                      const miss = v.at && !spoken.includes(v.at.replace(PUNCT, ""));
                      return (
                        <div
                          key={vi}
                          className={`rounded border p-2 text-xs ${
                            miss ? "border-red-800 bg-red-950/30"
                              : v.generateError ? "border-amber-800 bg-amber-950/20"
                              : "border-gray-800 bg-gray-950/40"
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              className="bg-gray-800 rounded px-1 py-0.5 text-xs"
                              value={v.type}
                              disabled={dis}
                              onChange={(e) =>
                                patchVisual(si, bi, vi, { type: e.target.value as VisualType })}
                            >
                              {(Object.keys(TYPE_LABEL) as VisualType[]).map((t) => (
                                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                              ))}
                            </select>

                            <label className="text-gray-500">锚点</label>
                            <input
                              className={`w-24 bg-gray-900 border rounded px-1.5 py-0.5 ${
                                miss ? "border-red-600" : "border-gray-700"}`}
                              value={v.at ?? ""}
                              disabled={dis}
                              placeholder="留空=开头"
                              onChange={(e) => patchVisual(si, bi, vi, { at: e.target.value })}
                            />
                            {miss ? (
                              <span className="text-red-400">口播里没有这个词</span>
                            ) : null}

                            {!readOnly ? (
                              <button
                                className="ml-auto text-gray-600 hover:text-red-400"
                                onClick={() => removeVisual(si, bi, vi)}
                                title="删除"
                              >
                                ✕
                              </button>
                            ) : null}
                          </div>

                          <div className="mt-1.5 grid gap-1.5">
                            {NEEDS[v.type].includes("latex") ? (
                              <input
                                className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5
                                           font-mono"
                                placeholder="LaTeX，如 a^2+b^2=c^2"
                                value={v.latex ?? ""}
                                disabled={dis}
                                onChange={(e) => patchVisual(si, bi, vi, { latex: e.target.value })}
                              />
                            ) : null}
                            {NEEDS[v.type].includes("text") ? (
                              <input
                                className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5"
                                placeholder="板书内容"
                                value={v.text ?? ""}
                                disabled={dis}
                                onChange={(e) => patchVisual(si, bi, vi, { text: e.target.value })}
                              />
                            ) : null}
                            {NEEDS[v.type].includes("items") ? (
                              <input
                                className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5"
                                placeholder="要点，用 | 分隔"
                                value={(v.items ?? []).join(" | ")}
                                disabled={dis}
                                onChange={(e) =>
                                  patchVisual(si, bi, vi, {
                                    items: e.target.value.split("|").map((s) => s.trim()).filter(Boolean),
                                  })}
                              />
                            ) : null}

                            <input
                              className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5"
                              placeholder={
                                v.type === "manim"
                                  ? "意图：这段动画要帮学生理解什么（Manim 代码生成会照此写）"
                                  : "意图（可选，备注这条视觉为什么存在）"
                              }
                              value={v.intent ?? ""}
                              disabled={dis}
                              onChange={(e) => patchVisual(si, bi, vi, { intent: e.target.value })}
                            />

                            {v.type === "manim" ? (
                              <div className="flex items-center gap-2 mt-1">
                                {v.sceneCode && !v.generateError ? (
                                  <span className="text-emerald-400">✓ 代码已生成</span>
                                ) : (
                                  <span className="text-amber-400">
                                    {v.generateError ? "生成失败，见日志" : "待生成"}
                                  </span>
                                )}
                                {v.sceneCode ? (
                                  <details className="flex-1">
                                    <summary className="cursor-pointer text-gray-500">
                                      查看代码
                                    </summary>
                                    <pre className="mt-1 max-h-48 overflow-auto bg-black/60 p-2
                                                    rounded text-[10px] leading-snug">
                                      {v.sceneCode}
                                    </pre>
                                  </details>
                                ) : null}
                              </div>
                            ) : null}

                            {v.generateError ? (
                              <pre className="mt-1 text-[10px] text-amber-300/80 bg-black/40 p-1.5
                                              rounded overflow-auto max-h-24">
                                {v.generateError}
                              </pre>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {!readOnly ? (
                      <div className="flex flex-wrap gap-1">
                        {(Object.keys(TYPE_LABEL) as VisualType[]).map((t) => (
                          <button
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800
                                       hover:bg-gray-700 text-gray-300"
                            onClick={() => addVisual(si, bi, t)}
                          >
                            + {TYPE_LABEL[t]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};