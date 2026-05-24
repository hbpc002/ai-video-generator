import { interpolate, useCurrentFrame, Easing } from "remotion";
import type { VideoStyle } from "../types";

// ──────────── Particles ────────────

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  delay: number;
  opacity: number;
}

const PARTICLES: Particle[] = Array.from({ length: 40 }, (_, i) => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: 2 + Math.random() * 6,
  speed: 0.3 + Math.random() * 0.5,
  delay: Math.random() * 200,
  opacity: 0.15 + Math.random() * 0.35,
}));

const STYLE_COLORS: Record<VideoStyle, string> = {
  tech: "167, 139, 250",
  minimal: "200, 200, 210",
  cute: "255, 107, 157",
};

export const Particles: React.FC<{ style?: VideoStyle }> = ({ style = "tech" }) => {
  const frame = useCurrentFrame();
  const color = STYLE_COLORS[style];

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {PARTICLES.map((p, i) => {
        const driftFrame = Math.max(0, (frame - p.delay * 0.5) * p.speed);
        const driftX = Math.sin(driftFrame * 0.01 + p.x) * 30;
        const driftY = Math.sin(driftFrame * 0.008 + p.y) * 40;
        const pulse = 0.7 + 0.3 * Math.sin(frame * 0.02 + i);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x + driftX * 0.1}%`,
              top: `${p.y + driftY * 0.1}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              background: `rgba(${color}, ${p.opacity * pulse})`,
              transform: `translate(${driftX}px, ${driftY}px)`,
              boxShadow: `0 0 ${p.size * 2}px rgba(${color}, ${p.opacity * pulse * 0.5})`,
              transition: "none",
            }}
          />
        );
      })}
    </div>
  );
};

// ──────────── Animated Background ────────────

interface ScenePalette {
  hue: number;
  sat: number;
  light: number;
}

const STYLE_SCENES: Record<VideoStyle, ScenePalette[]> = {
  tech: [
    { hue: 250, sat: 38, light: 8 },   // 开篇 - 蓝紫
    { hue: 220, sat: 35, light: 10 },  // 冷静蓝
    { hue: 200, sat: 30, light: 9 },   // 青
    { hue: 270, sat: 40, light: 10 },  // 紫
    { hue: 300, sat: 35, light: 9 },   // 粉紫
    { hue: 190, sat: 30, light: 8 },   // 冷灰
  ],
  minimal: [
    { hue: 0, sat: 0, light: 12 },    // 深灰
    { hue: 220, sat: 5, light: 14 },  // 冷灰
    { hue: 0, sat: 0, light: 10 },    // 深灰
    { hue: 40, sat: 3, light: 13 },   // 暖灰
    { hue: 0, sat: 0, light: 11 },    // 中性
    { hue: 210, sat: 4, light: 12 },  // 冷调
  ],
  cute: [
    { hue: 340, sat: 25, light: 12 }, // 粉
    { hue: 330, sat: 20, light: 14 }, // 粉紫
    { hue: 350, sat: 22, light: 11 }, // 暖粉
    { hue: 320, sat: 18, light: 13 }, // 粉紫
    { hue: 0, sat: 15, light: 12 },   // 暖
    { hue: 340, sat: 25, light: 15 }, // 亮粉
  ],
};

export const AnimatedBackground: React.FC<{
  frame: number;
  totalFrames: number;
  style?: VideoStyle;
}> = ({ frame, totalFrames, style = "tech" }) => {
  const progress = totalFrames > 0 ? frame / totalFrames : 0;
  const scenes = STYLE_SCENES[style];
  const sceneIdx = Math.min(Math.floor(progress * scenes.length), scenes.length - 1);
  const s = scenes[sceneIdx];
  const hue1 = scenes[Math.max(0, sceneIdx - 1)]?.hue ?? s.hue;
  const hue = scenes.length > 0 ? interpolate(
    (progress * scenes.length) % 1,
    [0, 1],
    [hue1, s.hue],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  ) : s.hue;

  // Style-specific accent colors
  const accentHueOffset = style === "cute" ? 30 : style === "minimal" ? 10 : 40;
  const accentSatOffset = style === "cute" ? 10 : style === "minimal" ? -2 : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          radial-gradient(ellipse 80% 60% at 30% 20%, 
            hsl(${hue}, ${s.sat + 10}%, ${s.light + 6}%) 0%, 
            transparent 60%),
          radial-gradient(ellipse 60% 80% at 70% 80%, 
            hsl(${hue + accentHueOffset}, ${s.sat + accentSatOffset}%, ${s.light + 3}%) 0%, 
            transparent 50%),
          linear-gradient(180deg, 
            hsl(${hue}, ${s.sat}%, ${s.light}%) 0%, 
            hsl(${hue + 20}, ${s.sat - 5}%, ${s.light - 2}%) 100%)
        `,
      }}
    />
  );
};

// ──────────── Decorative Ring ────────────

export const DecorativeRing: React.FC<{
  frame: number;
  delay?: number;
  size?: number;
  color?: string;
}> = ({ frame, delay = 0, size = 400, color = "rgba(167,139,250,0.08)" }) => {
  const localFrame = Math.max(0, frame - delay);
  const scale = 0.8 + 0.2 * Math.sin(localFrame * 0.02);
  const opacity = 0.4 + 0.3 * Math.sin(localFrame * 0.015 + 1);

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `1px solid ${color}`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

// ──────────── DrawLine ────────────

export const DrawLine: React.FC<{
  frame: number;
  startFrame: number;
  width?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ frame, startFrame, width = 200, color = "rgba(167,139,250,0.4)", style }) => {
  const localFrame = frame - startFrame;
  const progress = interpolate(
    localFrame,
    [0, 20],
    [0, width],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const opacity = interpolate(localFrame, [0, 10, 30, 50], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity, ...style }}>
      <div style={{ width: progress, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
    </div>
  );
};