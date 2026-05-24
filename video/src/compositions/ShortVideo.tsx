import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Series,
} from "remotion";
import { ShortVideoProps, VideoStyle } from "../types";
import { RichScene } from "../components/Scene";
import { Particles, AnimatedBackground, DecorativeRing } from "../components/Background";

// 计算累积帧偏移（每个场景从哪一帧开始）
function computeSceneStartFrames(sceneDurations: number[], fps: number): number[] {
  const startFrames: number[] = [0]; // 开场从第 0 帧开始
  let cumulative = 0;
  for (let i = 0; i < sceneDurations.length - 1; i++) { // 不包括最后一个场景（它延伸到视频结束）
    cumulative += Math.round(sceneDurations[i] * fps);
    startFrames.push(cumulative);
  }
  return startFrames;
}

const STYLE_INTRO = {
  tech: {
    bg: "linear-gradient(135deg, #0a0a2e 0%, #16213e 50%, #0f3460 100%)",
    titleColor: "#c4b5fd",
    subtitleColor: "rgba(167,139,250,0.6)",
    accent: "#00D4FF",
  },
  minimal: {
    bg: "linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 50%, #333 100%)",
    titleColor: "#f0f0f0",
    subtitleColor: "rgba(200,200,210,0.5)",
    accent: "#aaa",
  },
  cute: {
    bg: "linear-gradient(135deg, #2a1520 0%, #3a1a2e 50%, #4a2035 100%)",
    titleColor: "#f9a8d4",
    subtitleColor: "rgba(255,107,157,0.5)",
    accent: "#FF6B9D",
  },
};

const IntroCard: React.FC<{ title: string; style: VideoStyle; totalFrames: number; globalFrame: number }> = ({ 
  title, style, totalFrames, globalFrame 
}) => {
  const frame = useCurrentFrame();
  const theme = STYLE_INTRO[style];

  const opacity = interpolate(frame, [0, 20, 50, 60], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 25], [0.85, 1], {
    extrapolateRight: "clamp",
  });

  // Characters explode in one by one
  const chars = title.split("");

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AnimatedBackground frame={globalFrame} totalFrames={totalFrames} style={style} />
      <Particles style={style} />
      <DecorativeRing frame={frame} size={500} color={`${theme.accent}15`} />
      <DecorativeRing frame={frame} delay={15} size={350} color={`${theme.accent}10`} />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity,
          transform: `scale(${scale})`,
          zIndex: 10,
        }}
      >
        <div style={{ textAlign: "center", padding: "0 60px" }}>
          {/* Animated title chars */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {chars.map((ch, i) => {
              const cf = Math.max(0, frame - i * 4);
              const charScale = interpolate(cf, [0, 20], [2, 1], {
                extrapolateLeft: "clamp", extrapolateRight: "clamp",
              });
              const charOpacity = interpolate(cf, [0, 15], [0, 1], {
                extrapolateLeft: "clamp", extrapolateRight: "clamp",
              });
              const shimmer = 0.6 + 0.4 * Math.sin(frame * 0.03 + i * 2);
              return (
                <span key={i} style={{
                  fontFamily: "'Noto Serif SC', serif",
                  fontSize: 80,
                  fontWeight: 900,
                  color: `hsl(260, ${60 + shimmer * 30}%, ${75 + shimmer * 15}%)`,
                  opacity: ch === " " ? 0 : charOpacity,
                  transform: `scale(${charScale})`,
                  textShadow: ch === " " ? undefined : `0 0 ${30 * shimmer}px rgba(167,139,250,${0.3 * shimmer})`,
                  display: "inline-block",
                }}>
                  {ch}
                </span>
              );
            })}
          </div>

          {/* Subtitle */}
          <div style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: 22,
            color: theme.subtitleColor,
            letterSpacing: 6,
            fontWeight: 300,
            opacity: interpolate(frame, [50, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            自动生成的短视频
          </div>

          {/* Accent line */}
          <div style={{
            marginTop: 30,
            height: 3,
            width: interpolate(frame, [45, 65], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
            margin: "30px auto 0",
            opacity: interpolate(frame, [45, 60, 65], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Brand watermark
const Watermark: React.FC<{ brandName: string; style: VideoStyle }> = ({ brandName, style }) => {
  const colorMap: Record<VideoStyle, string> = {
    tech: "rgba(0, 212, 255, 0.5)",
    minimal: "rgba(255, 255, 255, 0.25)",
    cute: "rgba(255, 107, 157, 0.5)",
  };

  return (
    <div style={{ position: "absolute", bottom: 60, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 100 }}>
      <div style={{
        fontSize: 28,
        fontFamily: "'Noto Serif SC', serif",
        color: colorMap[style],
        letterSpacing: 4,
        fontWeight: 300,
      }}>
        {brandName}
      </div>
    </div>
  );
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  scenes,
  style,
  title,
  brandName = "AI 视频",
  sceneDurations, // 可选：音频时长数组（含开场），用于动态场景切换
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const globalFrame = useCurrentFrame();

  // 如果有 sceneDurations，使用动态时长；否则使用固定时长
  const useDynamicDurations = sceneDurations && sceneDurations.length > 0;
  
  const introDuration = useDynamicDurations
    ? Math.round(sceneDurations[0] * fps)
    : 4 * fps;
  
  const sceneCount = scenes.length;
  
  // 计算每个场景的时长（动态或固定）
  const getSceneDuration = (index: number): number => {
    if (useDynamicDurations && sceneDurations && sceneDurations[index + 1] !== undefined) {
      return Math.round(sceneDurations[index + 1] * fps);
    }
    return 6 * fps; // 固定 6 秒
  };

  // 计算总帧数（用于背景动画）
  const totalFrames = useDynamicDurations
    ? durationInFrames
    : introDuration + sceneCount * (6 * fps);

  // 计算场景起始帧偏移
  const sceneStartFrames = useDynamicDurations
    ? computeSceneStartFrames(sceneDurations!, fps)
    : Array.from({ length: sceneCount }, (_, i) => introDuration + i * 6 * fps);

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        <Series.Sequence durationInFrames={introDuration}>
          <IntroCard title={title} style={style} totalFrames={totalFrames} globalFrame={globalFrame} />
        </Series.Sequence>

        {scenes.map((scene, index) => {
          const sceneDuration = getSceneDuration(index);
          const sceneGlobalStart = sceneStartFrames[index + 1] ?? introDuration + index * 6 * fps;
          return (
            <Series.Sequence key={index} durationInFrames={sceneDuration}>
              <AbsoluteFill>
                <RichScene
                  scene={scene}
                  style={style}
                  sceneIndex={index}
                  totalFrames={totalFrames}
                  globalFrame={globalFrame - sceneGlobalStart + introDuration}
                />
                <Watermark brandName={brandName} style={style} />
              </AbsoluteFill>
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};