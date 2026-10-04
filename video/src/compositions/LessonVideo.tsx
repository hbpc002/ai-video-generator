import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  LESSON_THEME,
  type LessonVideoProps,
  type ResolvedBeat,
  type ResolvedSection,
} from "../lessonTypes";
import { VisualEventLayer } from "../components/lesson/VisualEventLayer";

const FONT_SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_SERIF = '"Noto Serif SC", Georgia, serif';

const TITLE_SEC = 3.5;
const SECTION_SEC = 2.2;

// ---- 时间轴展平 ----
// Remotion 的 <Series> 只吃扁平的、带显式时长的子节点，
// 所以先把「课程 → 章节 → beat」三层结构压平成一条线性序列。

type Segment =
  | { kind: "title"; frames: number }
  | { kind: "section"; sectionIndex: number; title: string; frames: number }
  | { kind: "beat"; sectionIndex: number; beatIndex: number; beat: ResolvedBeat; frames: number };

const flatten = (sections: ResolvedSection[], fps: number): Segment[] => {
  const segs: Segment[] = [{ kind: "title", frames: Math.round(TITLE_SEC * fps) }];

  sections.forEach((section, si) => {
    if (section.title) {
      segs.push({
        kind: "section",
        sectionIndex: si,
        title: section.title,
        frames: Math.round(SECTION_SEC * fps),
      });
    }
    section.beats.forEach((beat, bi) => {
      const quizPause = beat.quiz?.pauseSec ?? 0;
      segs.push({
        kind: "beat",
        sectionIndex: si,
        beatIndex: bi,
        beat,
        frames: Math.round((beat.durationSec + quizPause) * fps),
      });
    });
  });

  return segs;
};

// ---- 开场 ----

const TitleCard: React.FC<{ title: string; sectionTitles: string[] }> = ({
  title,
  sectionTitles,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24, 78, 100], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, 30], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 38%, #1b2440 0%, ${LESSON_THEME.bg} 62%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center", transform: `translateY(${rise}px)` }}>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 26,
            letterSpacing: 10,
            color: LESSON_THEME.accent,
            marginBottom: 28,
            opacity: 0.75,
          }}
        >
          AI 课程
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontSize: 92,
            fontWeight: 800,
            color: LESSON_THEME.text,
            lineHeight: 1.25,
            padding: "0 120px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            margin: "44px auto 0",
            width: 140,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${LESSON_THEME.accent}, transparent)`,
          }}
        />
        {sectionTitles.length > 0 ? (
          <div
            style={{
              marginTop: 40,
              display: "flex",
              gap: 18,
              justifyContent: "center",
              flexWrap: "wrap",
              fontFamily: FONT_SANS,
              fontSize: 28,
              color: LESSON_THEME.textDim,
            }}
          >
            {sectionTitles.map((t, i) => (
              <span key={i} style={{ opacity: interpolate(frame, [50 + i * 8, 66 + i * 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                {i + 1}. {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---- 章节卡 ----

const SectionCard: React.FC<{ title: string; index: number }> = ({ title, index }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const barWidth = interpolate(frame, [6, 46], [0, 120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${LESSON_THEME.bg} 0%, #14192a 100%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity: enter,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 30,
          letterSpacing: 8,
          color: LESSON_THEME.accent,
          marginBottom: 22,
        }}
      >
        第 {index + 1} 节
      </div>
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontSize: 80,
          fontWeight: 700,
          color: LESSON_THEME.text,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 30,
          height: 3,
          width: barWidth,
          background: LESSON_THEME.accent,
        }}
      />
    </AbsoluteFill>
  );
};

// ---- 字幕 ----

const CaptionBar: React.FC<{ beat: ResolvedBeat }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const active = useMemo(() => {
    let hit: string | null = null;
    for (const c of beat.captions) {
      if (c.startSec !== null && c.startSec <= sec) hit = c.text;
      else if (c.startSec !== null && c.startSec > sec) break;
    }
    return hit;
  }, [beat.captions, sec]);

  if (!active) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 74,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 52,
          fontWeight: 600,
          color: LESSON_THEME.text,
          background: "rgba(0,0,0,0.62)",
          padding: "10px 30px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {active}
      </div>
    </div>
  );
};

// ---- 互动题 ----

const QuizPause: React.FC<{ beat: ResolvedBeat }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const quiz = beat.quiz;
  if (!quiz) return null;

  const pauseSec = quiz.pauseSec ?? 3;
  const startSec = beat.durationSec;
  const local = frame - startSec * fps;
  if (local < 0) return null;

  const enter = interpolate(local, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "rgba(8,10,18,0.96)",
        justifyContent: "center",
        alignItems: "center",
        opacity: enter,
        zIndex: 50,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 34,
          letterSpacing: 6,
          color: LESSON_THEME.accentWarm,
          marginBottom: 26,
        }}
      >
        想一想
      </div>
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontSize: 60,
          fontWeight: 700,
          color: LESSON_THEME.text,
          marginBottom: 44,
          textAlign: "center",
          padding: "0 160px",
        }}
      >
        {quiz.question}
      </div>
      <div style={{ display: "flex", gap: 28 }}>
        {quiz.options.map((opt, i) => (
          <div
            key={i}
            style={{
              fontFamily: FONT_SANS,
              fontSize: 38,
              color: LESSON_THEME.textDim,
              border: `2px solid rgba(255,255,255,0.2)`,
              borderRadius: 12,
              padding: "18px 46px",
            }}
          >
            {String.fromCharCode(65 + i)}. {opt}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---- 单个 beat：多视觉层叠加 ----

const BeatStage: React.FC<{ beat: ResolvedBeat }> = ({ beat }) => {
  // 纯色底，不能加渐变或色相漂移：Manim 片段渲染时用的是同一个
  // 纯色背景（pipeline/render_manim.py 的 --background），
  // 任何底色变化都会让片段边界露馅。
  return (
    <AbsoluteFill style={{ background: LESSON_THEME.bg }}>
      {beat.events.map((ev) => (
        <VisualEventLayer key={ev.id} ev={ev} />
      ))}

      <CaptionBar beat={beat} />
      <QuizPause beat={beat} />

      <Audio src={staticFile(`audio/${beat.audioPath}`)} />
    </AbsoluteFill>
  );
};

// ---- 进度条 ----

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = Math.min(1, frame / durationInFrames);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        background: "rgba(255,255,255,0.08)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${LESSON_THEME.accent}, ${LESSON_THEME.accentWarm})`,
        }}
      />
    </div>
  );
};

// ---- 主合成 ----

export const LessonVideo: React.FC<LessonVideoProps> = ({ timeline }) => {
  const { fps } = useVideoConfig();

  const segments = useMemo(
    () => flatten(timeline.sections, fps),
    [timeline.sections, fps],
  );

  return (
    <AbsoluteFill
      style={{
        background: LESSON_THEME.bg,
        fontFamily: FONT_SANS,
      }}
    >
      <Series>
        {segments.map((seg, i) => {
          if (seg.kind === "title") {
            return (
              <Series.Sequence key={i} durationInFrames={seg.frames}>
                <TitleCard
                  title={timeline.title}
                  sectionTitles={timeline.sections
                    .map((s) => s.title)
                    .filter(Boolean)}
                />
              </Series.Sequence>
            );
          }
          if (seg.kind === "section") {
            return (
              <Series.Sequence key={i} durationInFrames={seg.frames}>
                <SectionCard title={seg.title} index={seg.sectionIndex} />
              </Series.Sequence>
            );
          }
          return (
            <Series.Sequence key={i} durationInFrames={seg.frames}>
              <BeatStage beat={seg.beat} />
            </Series.Sequence>
          );
        })}
      </Series>

      <ProgressBar />
    </AbsoluteFill>
  );
};