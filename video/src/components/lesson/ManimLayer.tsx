import React from "react";
import {
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ResolvedEvent } from "../../lessonTypes";

/**
 * 播放预渲染好的 Manim 片段。
 *
 * 时长问题已在 pipeline/render_manim.py 里用 ffmpeg 解决：
 * 片段短则定格末帧补齐、长则裁剪，产物时长 == beat 旁白时长。
 * 所以这里不需要任何补偿逻辑，只按 beat 窗口播放即可。
 *
 * manim 事件的 startSec 恒为 0 —— 片段内部的节奏由场景作者用
 * narrator.wait_for() 对齐，`at` 锚点对它没有意义。
 */
export const ManimLayer: React.FC<{ ev: ResolvedEvent }> = ({ ev }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!ev.clipPath) return null;

  const startFrame = Math.round(ev.startSec * fps);
  const f = Math.max(0, frame - startFrame);

  const enter = interpolate(f, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    // 用普通 div 而不是 AbsoluteFill —— AbsoluteFill 会强制 inset:0，
    // 和这里的百分比 left/top/width 打架，导致片段被挤到角落。
    // 定位约定与其他 VisualEventLayer 保持一致。
    <div
      style={{
        position: "absolute",
        left: `${ev.layout?.x ?? 50}%`,
        top: `${ev.layout?.y ?? 50}%`,
        width: `${ev.layout?.w ?? 72}%`,
        aspectRatio: "16 / 9",
        transform: `translate(-50%, -50%) scale(${ev.layout?.scale ?? 1})`,
        opacity: enter,
      }}
    >
      <OffthreadVideo
        src={staticFile(ev.clipPath)}
        // Manim 输出 60fps，这里交给 Remotion 按合成 fps 抽帧
        playbackRate={1}
        pauseWhenBuffering
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
};