import type { LessonDoc, LessonSection, VisualEvent } from "./types";

export interface Issue {
  level: "error" | "warn";
  where: string;
  message: string;
}

const PUNCT = /[，。！？；：、,.!?;:]/g;

/**
 * 校验一份课程设计。
 *
 * 最要紧的是锚点检查：at 是「旁白念到这个词时让画面动起来」的触发词，
 * 如果它不在口播里，画面就永远不出现 —— 而视频照样能渲出来，
 * 只是那段位置是空的。这种 bug 很难在成片里一眼看出来，所以必须在这里拦。
 */
export const validate = (lesson: unknown): Issue[] => {
  const issues: Issue[] = [];
  const doc = lesson as LessonDoc;

  if (!doc || typeof doc !== "object") {
    return [{ level: "error", where: "根", message: "不是合法的 JSON 对象" }];
  }
  if (!doc.title) {
    issues.push({ level: "error", where: "根", message: "缺 title" });
  }
  if (!Array.isArray(doc.sections) || !doc.sections.length) {
    issues.push({ level: "error", where: "根", message: "sections 为空" });
    return issues;
  }

  doc.sections.forEach((sec: LessonSection, si: number) => {
    const sWhere = `第${si + 1}节「${sec?.title ?? "?"}」`;
    if (!sec?.title) {
      issues.push({ level: "error", where: `第${si + 1}节`, message: "缺 title" });
    }
    if (!Array.isArray(sec?.beats) || !sec.beats.length) {
      issues.push({ level: "error", where: sWhere, message: "beats 为空" });
      return;
    }

    sec.beats.forEach((beat, bi: number) => {
      const bWhere = `${sWhere}/单元${bi + 1}`;
      const narration: string = beat?.narration ?? "";

      if (!narration.trim()) {
        issues.push({ level: "error", where: bWhere, message: "narration 为空" });
        return;
      }
      const spoken = narration.replace(PUNCT, "");
      const chars = narration.replace(/\s/g, "").length;
      if (chars < 25) {
        issues.push({
          level: "warn",
          where: bWhere,
          message: `口播偏短（${chars} 字），可能撑不起一个视觉单元`,
        });
      }
      if (chars > 220) {
        issues.push({
          level: "warn",
          where: bWhere,
          message: `口播偏长（${chars} 字），建议拆成多个单元`,
        });
      }

      const plan = beat.visuals;
      if (plan !== undefined && !Array.isArray(plan)) {
        issues.push({
          level: "warn",
          where: bWhere,
          message: "visuals 必须是数组",
        });
        return;
      }

      const seen = new Map<string, number>();
      (plan ?? []).forEach((v: VisualEvent, vi: number) => {
        const vWhere = `${bWhere}/视觉${vi + 1}${v?.type ? `(${v.type})` : ""}`;
        if (!v?.type) {
          issues.push({ level: "error", where: vWhere, message: "缺 type" });
        }
        if (v?.type === "manim") {
          if (!v.sceneCode) {
            issues.push({
              level: "warn",
              where: vWhere,
              message: "还没生成 Manim 代码（点「生成 Manim 代码」）",
            });
          } else if (v.generateError) {
            issues.push({
              level: "error",
              where: vWhere,
              message: `Manim 代码生成失败：${v.generateError.split("\n")[0]}`,
            });
          }
        }
        if (!v?.intent && v?.type === "manim") {
          // 只对 Manim 报 —— intent 只被阶段②用来写代码，
          // 其他类型的视觉没有任何阶段读它，提醒了 pure 是噪音
          issues.push({
            level: "warn",
            where: vWhere,
            message: "缺 intent，Manim 代码生成会不知道要画什么",
          });
        }

        const at = (v?.at ?? "").trim();
        if (!at) return;
        if (at.length > 8) {
          issues.push({
            level: "warn",
            where: vWhere,
            message: `锚点偏长（${at.length} 字）：「${at}」，建议 2-6 字`,
          });
        }
        if (!spoken.includes(at.replace(PUNCT, ""))) {
          issues.push({
            level: "error",
            where: vWhere,
            message: `锚点「${at}」在口播里找不到，画面永远不会被触发`,
          });
        }
        if (seen.has(at)) {
          issues.push({
            level: "warn",
            where: vWhere,
            message: `锚点「${at}」与视觉${(seen.get(at) ?? 0) + 1} 重复，两处会同时触发`,
          });
        } else {
          seen.set(at, vi);
        }
      });

      if (beat.quiz && (!Array.isArray(beat.quiz.options) || beat.quiz.options.length < 2)) {
        issues.push({
          level: "warn",
          where: `${bWhere}/小测`,
          message: "选项少于 2 个",
        });
      }
    });
  });

  return issues;
};

/** 统计信息，给 UI 显示 */
export const statsOf = (lesson: LessonDoc) => {
  const beats = lesson.sections?.flatMap((s) => s.beats ?? []) ?? [];
  const visuals = beats.flatMap((b) => b.visuals ?? []);
  return {
    sections: lesson.sections?.length ?? 0,
    beats: beats.length,
    visuals: visuals.length,
    manimClips: visuals.filter((v) => v.type === "manim").length,
    chars: beats.reduce((a, b) => a + (b.narration ?? "").replace(/\s/g, "").length, 0),
  };
};