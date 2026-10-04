// 教学视频数据结构（区别于抖音的 SceneData 扁平结构）
//
// 核心差异：抖音是「一句话配一个素材」；教学是「一个连续镜头里叠多个视觉事件，
// 每个事件靠旁白关键词锚定」。所以最小单位是 beat（一段完整讲解），
// 而不是一个分句。

// ---- 脚本侧（人 / LLM 写） ----

export type VisualType =
  | "equation"   // 公式：分项/整体浮现
  | "board"      // 板书：手写逐字浮现
  | "diagram"    // 图形：SVG 路径 draw-on
  | "image"      // 配图：Ken Burns
  | "highlight"  // 聚光高亮某个已存在的元素
  | "list"       // 要点列表：逐条点亮
  | "manim"      // Manim 片段（几何/函数/公式推导），由 pipeline/render_manim.py 预渲染
  | "video";     // 情景短片（豆包课堂那种引子）

export interface VisualEvent {
  type: VisualType;
  // 锚点关键词。留空则事件从 beat 开头就出现。
  at?: string;
  // 视觉位置。用百分比而非像素，横竖屏自适应。
  layout?: {
    x?: number;      // 0-100，默认 50（居中）
    y?: number;      // 0-100
    w?: number;      // 0-100 宽度
    scale?: number;  // 缩放
  };
  // equation
  latex?: string;
  reveal?: "whole" | "term-by-term";
  // board
  text?: string;
  font?: "hand" | "serif" | "sans";
  // diagram
  svg?: string;        // 内联 SVG markup，或 d 属性（单 path）
  strokeWidth?: number;
  drawDuration?: number; // 秒，默认 1.2
  // image
  imageUrl?: string;
  kenBurns?: boolean;
  // highlight / list
  target?: string;     // 指向同 beat 内其他事件的 id
  items?: string[];    // list 专用
  // video
  src?: string;
  // manim：由 render_manim.py 回填
  sceneCode?: string;   // Manim 场景源码，含 narrator.wait_for(...) 同步调用
  className?: string;   // 场景类名，默认 "Scene"
  clipPath?: string;    // 渲染产物相对 public/ 的路径
  clipDurationSec?: number;
  clipIsTransparent?: boolean;
  // 到 endSec 之后是否留在画面上。默认按类型推断：
  // highlight=false（指一下就退），其余=true（内容应留存）。
  persist?: boolean;
}

export interface Beat {
  narration: string;              // 一整段讲解，不再切碎
  visuals?: VisualEvent[];         // 镜头内叠加的视觉层
  captions?: { atWord: string; text?: string }[];  // 不填则跟随全部词
  quiz?: {                         // 互动题（做成"停顿+字幕提问"）
    question: string;
    options: string[];
    pauseSec?: number;             // 默认 3
  };
  layout?: "auto" | "center" | "left-text-right-visual" | "full-visual";
}

// ---- 解析侧（脚本 + TTS 时间戳 + fps 合成，由 Python 产出） ----

export interface ResolvedWord {
  text: string;
  start: number;   // 秒，相对 beat 起点
  end: number;
}

export interface ResolvedEvent extends VisualEvent {
  id: string;
  startSec: number;
  endSec: number;
  resolved: boolean;
}

export interface ResolvedCaption {
  text: string;
  startSec: number | null;
}

export interface ResolvedBeat {
  narration: string;
  audioPath: string;
  durationSec: number;
  words: ResolvedWord[];
  events: ResolvedEvent[];
  captions: ResolvedCaption[];
  layout: Beat["layout"];
  quiz?: Beat["quiz"];
}

export interface ResolvedSection {
  title: string;
  hookVideo?: { src?: string; prompt?: string } | null;
  beats: ResolvedBeat[];
}

export interface LessonTimeline {
  fps: number;
  width: number;
  height: number;
  style: string;
  title: string;
  sections: ResolvedSection[];
  warnings: {
    level: "error" | "warn";
    section: number;
    beat: number;
    anchor?: string;
    reason: string;
    hint?: string;
  }[];
}

// ---- Remotion 合成侧 ----

export interface LessonVideoProps {
  timeline: LessonTimeline;
  brandName?: string;
}

// 教学视频配色（横屏 1920x1080，投屏友好）
export const LESSON_THEME = {
  bg: "#0f1117",
  boardBg: "#f7f4ec",
  boardInk: "#1a2744",
  text: "#e8eaf0",
  textDim: "#8b93a7",
  accent: "#4a9eff",
  accentWarm: "#ffb454",
  formula: "#ffffff",
  highlight: "rgba(74, 158, 255, 0.22)",
  highlightEdge: "#4a9eff",
} as const;