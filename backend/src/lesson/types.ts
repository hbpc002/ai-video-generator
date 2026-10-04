// 教学视频的数据结构。
//
// 放在 backend/src 而不是 pipeline/，因为 web 编辑器也要用：
// backend/tsconfig.json 设了 rootDir=./src，引用不了 src 之外的模块。
// 于是 domain 归 backend，pipeline 里的脚本反向引用这里 —— 依赖方向
// 和编译约束是一致的。

export type VisualType =
  | "manim"
  | "equation"
  | "board"
  | "diagram"
  | "list"
  | "highlight"
  | "image"
  | "video";

export interface VisualEvent {
  id?: string;
  type: VisualType;
  /** 锚点关键词，必须原样出现在 narration 里 */
  at?: string;
  /** 这个视觉要帮学生理解什么 —— Manim 代码生成阶段照此写代码 */
  intent?: string;
  latex?: string;
  text?: string;
  items?: string[];
  imageUrl?: string;
  layout?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    scale?: number;
  };
  persist?: boolean;

  // ---- manim 专用，由阶段②回填 ----
  sceneCode?: string;
  className?: string;
  clipPath?: string;
  clipDurationSec?: number;
  /** 生成失败时保留的实际报错，供人工接着改 */
  generateError?: string;

  // ---- 解析侧字段（时间轴产出，只读） ----
  startSec?: number;
  endSec?: number;
  resolved?: boolean;
  clipRawDurationSec?: number;
}

export interface Quiz {
  question: string;
  options: string[];
  pauseSec?: number;
}

export interface Beat {
  /** 一整段口播，不再切碎 —— 这是教学视频和抖音短视频的核心区别 */
  narration: string;
  visuals?: VisualEvent[];
  captions?: { atWord: string; text?: string; startSec?: number }[];
  quiz?: Quiz;
  layout?: "auto" | "center" | "left-text-right-visual" | "full-visual";

  // ---- 解析侧（只读，由 edge_timeline.py 回填） ----
  durationSec?: number;
  audioPath?: string;
  /**
   * 词级时间戳。只有**时间轴 JSON**里才有；手写的 lesson JSON 里没有。
   * gen-manim 阶段靠它给模型列可用锚点，所以它的输入必须是时间轴。
   */
  words?: { text: string; start: number; end: number }[];
}

export interface LessonSection {
  title: string;
  hookVideo?: { src?: string; prompt?: string } | null;
  beats: Beat[];
}

export interface LessonDoc {
  title: string;
  fps: number;
  width: number;
  height: number;
  style: string;
  learningObjectives?: string[];
  sections: LessonSection[];
}

/** 作业状态：整条流水线跑下来可能好几分钟，需要能查进度 */
export type LessonJobStatus = "running" | "done" | "error";

export type LessonJobStep =
  | "queued"
  | "design"
  | "manim-code"
  | "timeline"
  | "manim-render"
  | "props"
  | "remotion"
  | "finished";

export interface LessonJob {
  id: string;
  kind: "design" | "manim-code" | "build";
  status: LessonJobStatus;
  step: LessonJobStep;
  progress: number;
  logs: string[];
  error?: string;
  lessonPath?: string;
  videoUrl?: string;
  stats?: { sections: number; beats: number; manimClips: number };
  startedAt: number;
  finishedAt?: number;
}