import React from "react";
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  LESSON_THEME,
  type ResolvedEvent,
  type VisualEvent,
} from "../../lessonTypes";
import { normalizeFormula, splitTerms } from "./formula";
import { ManimLayer } from "./ManimLayer";

const FONT_HAND = '"Kaiti SC", "STKaiti", KaiTi, "Noto Serif SC", serif';
const FONT_SERIF = '"Noto Serif SC", Georgia, serif';
const FONT_SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const fontOf = (font?: string): string => {
  if (font === "hand") return FONT_HAND;
  if (font === "sans") return FONT_SANS;
  return FONT_SERIF;
};

/** 用百分比定位，横竖屏换分辨率不用改数值 */
const boxOf = (ev: ResolvedEvent): React.CSSProperties => {
  const l = ev.layout ?? {};
  const w = l.w ?? 78;
  return {
    position: "absolute",
    left: `${l.x ?? 50}%`,
    top: `${l.y ?? 50}%`,
    width: `${w}%`,
    transform: `translate(-50%, -50%) scale(${l.scale ?? 1})`,
    opacity: 0,
  };
};

/** 入场：前 12 帧淡入 + 轻微上浮 */
const useEnter = (frames: number) => {
  const enter = interpolate(frames, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frames, [0, 14], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { enter, rise };
};

// ---- 公式 ----

const EquationLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  const { enter, rise } = useEnter(f);
  const formula = normalizeFormula(ev.latex ?? "");
  const termByTerm = ev.reveal === "term-by-term";
  const terms = termByTerm ? splitTerms(formula) : [formula];

  // 逐项浮现：每项 10 帧错开
  const visibleTerms = termByTerm
    ? terms.filter((_, i) => f >= i * 10)
    : terms;

  return (
    <div
      style={{
        ...boxOf(ev),
        opacity: enter,
        transform: `translate(-50%, calc(-50% + ${rise}px)) scale(${ev.layout?.scale ?? 1})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        flexWrap: "wrap",
      }}
    >
      {visibleTerms.map((t, i) => {
        // 运算符稍暗，视觉上区分「项」和「连接符」
        const isOp = t.length === 1 && "+-=".includes(t);
        const appear = interpolate(
          Math.max(0, f - i * 10),
          [0, 8],
          [0.6, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <span
            key={`${t}-${i}`}
            style={{
              fontFamily: FONT_SERIF,
              fontSize: 96,
              fontWeight: 600,
              color: isOp ? LESSON_THEME.accentWarm : LESSON_THEME.formula,
              opacity: appear,
              textShadow: "0 4px 24px rgba(0,0,0,0.5)",
              whiteSpace: "pre",
            }}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
};

// ---- 板书 ----

const BoardLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  const { enter, rise } = useEnter(f);
  const chars = Array.from(ev.text ?? "");

  return (
    <div
      style={{
        ...boxOf({ ...ev, layout: { ...ev.layout, w: ev.layout?.w ?? 60 } }),
        opacity: enter,
        transform: `translate(-50%, calc(-50% + ${rise}px)) rotate(-1.2deg)`,
        background: LESSON_THEME.boardBg,
        padding: "28px 44px",
        borderRadius: 6,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          fontFamily: fontOf(ev.font),
          fontSize: 72,
          color: LESSON_THEME.boardInk,
          lineHeight: 1.35,
          whiteSpace: "pre-wrap",
        }}
      >
        {chars.map((c, i) => {
          // 每字 3 帧错开，像逐字写上去
          const cf = Math.max(0, f - 4 - i * 3);
          const o = interpolate(cf, [0, 4], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                opacity: c === " " ? 0 : o,
                display: "inline-block",
              }}
            >
              {c}
            </span>
          );
        })}
      </div>
      {/* 底部手绘感下划线 */}
      <div
        style={{
          marginTop: 14,
          height: 4,
          width: `${interpolate(f, [10, 40], [0, 100], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}%`,
          background: `linear-gradient(90deg, ${LESSON_THEME.accent}, transparent)`,
          borderRadius: 2,
        }}
      />
    </div>
  );
};

// ---- 图形 ----

const DiagramLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  const { enter } = useEnter(f);
  const drawSec = ev.drawDuration ?? 1.2;
  const drawFrames = Math.max(1, drawSec * 30);
  const progress = interpolate(f, [0, drawFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        ...boxOf(ev),
        opacity: enter,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {ev.svg ? (
        // 内联完整 SVG（带 fill 的图形直接显示）
        <div
          style={{ width: "100%", transform: `scale(${0.9 + progress * 0.1})` }}
          dangerouslySetInnerHTML={{ __html: ev.svg }}
        />
      ) : null}
      <svg
        viewBox="0 0 400 300"
        style={{ width: "100%", overflow: "visible" }}
      >
        {/* 单 path 场景：用 dashoffset 做 draw-on */}
        <path
          d={ev.svg ?? "M50 250 L200 50 L350 250 Z"}
          fill="none"
          stroke={LESSON_THEME.accent}
          strokeWidth={ev.strokeWidth ?? 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - progress * 100}
        />
      </svg>
    </div>
  );
};

// ---- 配图 ----

const ImageLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  const { enter } = useEnter(f);
  const kb = ev.kenBurns !== false;
  // 缓慢推近，模拟 Ken Burns
  const scale = interpolate(f, [0, 180], [1.04, 1.16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        ...boxOf({ ...ev, layout: { ...ev.layout, w: ev.layout?.w ?? 46 } }),
        opacity: enter,
        height: "58%",
        overflow: "hidden",
        borderRadius: 10,
        border: `1px solid rgba(255,255,255,0.1)`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      {ev.imageUrl ? (
        <Img
          src={ev.imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: kb ? `scale(${scale})` : undefined,
          }}
        />
      ) : null}
    </div>
  );
};

// ---- 聚光高亮 ----

const HighlightLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  // 呼吸脉冲：和豆包课堂的 spotlight 观感一致
  const pulse = 0.5 + 0.5 * Math.sin(f * 0.09);
  const grow = interpolate(f, [0, 10], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        ...boxOf({ ...ev, layout: { ...ev.layout, w: ev.layout?.w ?? 30 } }),
        opacity: interpolate(f, [0, 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        transform: `translate(-50%, -50%) scale(${grow})`,
        border: `3px solid ${LESSON_THEME.highlightEdge}`,
        background: LESSON_THEME.highlight,
        boxShadow: `0 0 ${30 + pulse * 40}px ${LESSON_THEME.highlightEdge}`,
        borderRadius: 8,
        padding: "18px 30px",
        pointerEvents: "none",
      }}
    />
  );
};

// ---- 要点列表 ----

const ListLayer: React.FC<{ ev: ResolvedEvent; f: number }> = ({ ev, f }) => {
  const { enter, rise } = useEnter(f);
  const items = ev.items ?? [];

  return (
    <div
      style={{
        ...boxOf({ ...ev, layout: { ...ev.layout, w: ev.layout?.w ?? 62 } }),
        opacity: enter,
        transform: `translate(-50%, calc(-50% + ${rise}px))`,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {items.map((item, i) => {
        const o = interpolate(f - i * 9, [0, 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const x = interpolate(f - i * 9, [0, 12], [-24, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const isOn = o > 0.6;
        return (
          <div
            key={i}
            style={{
              opacity: o,
              transform: `translateX(${x}px)`,
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontFamily: FONT_SANS,
              fontSize: 46,
              color: isOn ? LESSON_THEME.text : LESSON_THEME.textDim,
              transition: "none",
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: isOn ? LESSON_THEME.accent : "transparent",
                border: `2px solid ${isOn ? LESSON_THEME.accent : LESSON_THEME.textDim}`,
                flexShrink: 0,
              }}
            />
            <span style={{ color: LESSON_THEME.text }}>{item}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---- 派发 ----

// 哪些类型在 endSec 之后继续留在画面上。
// 高亮是「指一下」的效果，到点就该退；公式/板书/列表是内容，应当留存。
const DEFAULT_PERSIST: Record<string, boolean> = {
  highlight: false,
  equation: true,
  board: true,
  diagram: true,
  image: true,
  list: true,
  manim: true,
  video: true,
};

// 本组件必须在 beat 的 <Series.Sequence> 内部渲染，
// 这样 useCurrentFrame() 拿到的就是 beat 相对帧。
export const VisualEventLayer: React.FC<{ ev: ResolvedEvent }> = ({ ev }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 减去锚点帧，得到事件自身的局部帧
  const startFrame = Math.round(ev.startSec * fps);
  const f = Math.max(0, frame - startFrame);

  // 到点退场：endSec 之后用 FADE 帧淡出并卸载，避免高亮框一直挂着
  const FADE = 12;
  const endFrame = Math.round(ev.endSec * fps);
  const persist =
    ev.persist !== undefined ? ev.persist : DEFAULT_PERSIST[ev.type] ?? true;

  let gate: React.CSSProperties = {};
  if (!persist && f > endFrame - startFrame) {
    if (f >= endFrame - startFrame + FADE) return null;
    const fadeOut = interpolate(
      f,
      [endFrame - startFrame, endFrame - startFrame + FADE],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    gate = { opacity: fadeOut };
  }

  const wrap = (node: React.ReactNode) => (
    <div style={{ position: "absolute", inset: 0, ...gate }}>{node}</div>
  );

  const body = () => {
    switch (ev.type) {
      case "equation": return wrap(<EquationLayer ev={ev} f={f} />);
      case "board": return wrap(<BoardLayer ev={ev} f={f} />);
      case "diagram": return wrap(<DiagramLayer ev={ev} f={f} />);
      case "image": return wrap(<ImageLayer ev={ev} f={f} />);
      case "highlight": return wrap(<HighlightLayer ev={ev} f={f} />);
      case "list": return wrap(<ListLayer ev={ev} f={f} />);
      case "manim": return wrap(<ManimLayer ev={ev} />);
      default: return null;
    }
  };

  return <>{body()}</>;
};