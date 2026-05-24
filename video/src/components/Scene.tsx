import React from "react";
import {
  useCurrentFrame,
  interpolate,
  Img,
  AbsoluteFill,
  Easing,
  staticFile,
} from "remotion";
import { SceneData, VideoStyle } from "../types";
import { Particles, AnimatedBackground, DecorativeRing } from "./Background";
import { CharReveal } from "./Animations";

interface RichSceneProps {
  scene: SceneData;
  style: VideoStyle;
  sceneIndex: number;
  totalFrames: number;
  globalFrame: number;
}

const STYLE_ACCENTS: Record<VideoStyle, {
  titleColor: string;
  bodyColor: string;
  tagColor: string;
  tagBg: string;
  tagBorder: string;
  sectionLabel: string;
  ringColor: string;
}> = {
  tech: {
    titleColor: "#c4b5fd",
    bodyColor: "rgba(241,245,249,0.85)",
    tagColor: "#00D4FF",
    tagBg: "rgba(0, 212, 255, 0.15)",
    tagBorder: "1px solid rgba(0, 212, 255, 0.4)",
    sectionLabel: "rgba(167,139,250,0.6)",
    ringColor: "rgba(167,139,250,0.08)",
  },
  minimal: {
    titleColor: "#f0f0f0",
    bodyColor: "rgba(200,200,210,0.8)",
    tagColor: "#aaa",
    tagBg: "rgba(255,255,255,0.08)",
    tagBorder: "1px solid rgba(255,255,255,0.15)",
    sectionLabel: "rgba(200,200,210,0.4)",
    ringColor: "rgba(200,200,210,0.06)",
  },
  cute: {
    titleColor: "#f9a8d4",
    bodyColor: "rgba(255,240,248,0.85)",
    tagColor: "#FF6B9D",
    tagBg: "rgba(255, 107, 157, 0.15)",
    tagBorder: "1px solid rgba(255, 107, 157, 0.4)",
    sectionLabel: "rgba(255,107,157,0.5)",
    ringColor: "rgba(255,107,157,0.08)",
  },
};

export const RichScene: React.FC<RichSceneProps> = ({
  scene,
  style,
  sceneIndex,
  totalFrames,
  globalFrame,
}) => {
  const frame = useCurrentFrame();
  const accents = STYLE_ACCENTS[style];

  // Scene timing within the scene window
  const titleStart = 5;
  const bodyStart = 40;
  const tagStart = 75;

  // Section label fade
  const labelOpacity = interpolate(frame, [0, 15, 40, 60], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  // Tags entrance
  const tagsOpacity = interpolate(
    Math.max(0, frame - tagStart),
    [0, 15], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Bottom line
  const lineWidth = interpolate(
    Math.max(0, frame - 20),
    [0, 25], [0, 80],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const lineOpacity = interpolate(
    Math.max(0, frame - 20),
    [0, 15, 30, 50], [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Section label
  const sectionLabel = scene.title.length > 4 ? scene.title.slice(0, 4) : scene.title;

  return (
    <AbsoluteFill>
      {/* Background layers */}
      <AnimatedBackground frame={globalFrame} totalFrames={totalFrames} style={style} />
      <Particles style={style} />
      <DecorativeRing frame={frame} size={600} color={accents.ringColor} />
      <DecorativeRing frame={frame} delay={30} size={450} color={accents.ringColor} />

      {/* Image as faded backdrop */}
      {scene.imageUrl && (
        <Img
          src={staticFile(scene.imageUrl)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.15,
            filter: "blur(8px)",
          }}
        />
      )}

      {/* Section label pill */}
      <div
        style={{
          position: "absolute",
          top: "8%",
          left: "50%",
          transform: "translateX(-50%)",
          opacity: labelOpacity,
          fontFamily: "'Noto Serif SC', serif",
          fontSize: 14,
          color: accents.sectionLabel,
          letterSpacing: 6,
        }}
      >
        {sectionLabel}
      </div>

      {/* Content area */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "85%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          zIndex: 10,
        }}
      >
        {/* Scene number badge */}
        <div
          style={{
            padding: "6px 20px",
            borderRadius: 20,
            background: accents.tagBg,
            border: accents.tagBorder,
            color: accents.tagColor,
            fontSize: 18,
            fontFamily: "'Noto Serif SC', serif",
            fontWeight: 500,
            letterSpacing: 2,
            marginBottom: 8,
          }}
        >
          {`0${sceneIndex + 1}`.slice(-2)}
        </div>

        {/* Title with per-character reveal */}
        <div style={{ textAlign: "center", lineHeight: 1.3 }}>
          <CharReveal
            text={scene.title}
            startFrame={titleStart}
            speed={4}
            size={72}
            weight={800}
            color={accents.titleColor}
          />
        </div>

        {/* Body text */}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <CharReveal
            text={scene.body}
            startFrame={bodyStart}
            speed={2}
            size={36}
            weight={400}
            color={accents.bodyColor}
          />
        </div>

        {/* Keywords as tags */}
        {scene.keywords && scene.keywords.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
              marginTop: 16,
              opacity: tagsOpacity,
            }}
          >
            {scene.keywords.slice(0, 3).map((kw, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 20px",
                  borderRadius: 20,
                  background: accents.tagBg,
                  border: accents.tagBorder,
                  color: accents.tagColor,
                  fontSize: 28,
                  fontFamily: "'Noto Serif SC', serif",
                  fontWeight: 500,
                }}
              >
                #{kw}
              </div>
            ))}
          </div>
        )}

        {/* Bottom decorative line */}
        <div
          style={{
            width: lineWidth,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accents.tagColor}, transparent)`,
            marginTop: 20,
            opacity: lineOpacity,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};