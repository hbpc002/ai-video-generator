import { interpolate, useCurrentFrame, Easing } from "remotion";

interface CharRevealProps {
  text: string;
  startFrame: number;
  speed?: number;
  color?: string;
  size?: number;
  weight?: number;
  style?: React.CSSProperties;
}

export const CharReveal: React.FC<CharRevealProps> = ({
  text,
  startFrame,
  speed = 3,
  color = "#f1f5f9",
  size = 48,
  weight = 600,
  style,
}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - startFrame);

  return (
    <span style={{ display: "inline", whiteSpace: "pre-wrap", ...style }}>
      {text.split("").map((char, i) => {
        const charStart = i * speed;
        const charEnd = charStart + 10;
        const progress = interpolate(
          localFrame,
          [charStart, charEnd],
          [0, 1],
          {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );
        const y = (1 - progress) * 20;
        const opacity = progress;
        const isSpace = char === " ";
        const isPunct = /[，。？、！；：]/.test(char);

        return (
          <span
            key={i}
            style={{
              display: "inline",
              opacity: isSpace ? 1 : opacity,
              transform: isSpace ? undefined : `translateY(${y}px)`,
              color: isPunct ? "rgba(167,139,250,0.7)" : color,
              fontSize: isPunct ? size * 0.85 : size,
              fontWeight: weight,
              fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
              transition: "none",
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
};

interface IconRingProps {
  icon: string;
  startFrame: number;
  label: string;
  index: number;
  style?: VideoStyle;
}

export const IconRing: React.FC<IconRingProps> = ({
  icon,
  startFrame,
  label,
  index,
  style = "tech",
}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - startFrame);
  const delay = index * 15;

  const progress = interpolate(
    localFrame - delay,
    [0, 20],
    [0, 1],
    { easing: Easing.bezier(0.34, 1.56, 0.64, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const scale = interpolate(progress, [0, 1], [0, 1]);
  const opacity = interpolate(localFrame - delay, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const ringScale = 1 + 0.15 * Math.sin(localFrame * 0.04);
  const ringOpacity = 0.3 + 0.2 * Math.sin(localFrame * 0.03);

  const labelProgress = interpolate(
    localFrame - delay - 10,
    [0, 15],
    [0, 1],
    { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const labelY = (1 - labelProgress) * 15;

  const ringColor = style === "tech" ? "rgba(167,139,250,0.3)" : 
                     style === "minimal" ? "rgba(200,200,210,0.3)" : 
                     "rgba(255,107,157,0.3)";
  const bgColor = style === "tech" ? "rgba(167,139,250,0.1)" : 
                  style === "minimal" ? "rgba(200,200,210,0.1)" : 
                  "rgba(255,107,157,0.1)";
  const labelColor = style === "tech" ? "#c4b5fd" : 
                     style === "minimal" ? "#888" : 
                     "#f9a8d4";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity, transform: `scale(${scale})` }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <div style={{ position: "absolute", inset: -6, borderRadius: "50%", border: `1.5px solid ${ringColor}`, transform: `scale(${ringScale})`, opacity: ringOpacity }} />
        <div style={{ position: "absolute", inset: 4, borderRadius: "50%", background: bgColor, border: `1px solid ${ringColor}` }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>{icon}</div>
      </div>
      <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 22, fontWeight: 600, color: labelColor, opacity: labelProgress, transform: `translateY(${labelY}px)` }}>
        {label}
      </span>
    </div>
  );
};

import type { VideoStyle } from "../types";