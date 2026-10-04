import React from "react";
import { Composition } from "remotion";
import { ShortVideo } from "./compositions/ShortVideo";
import { LessonVideo } from "./compositions/LessonVideo";
import type { ShortVideoProps } from "./types";
import type { LessonTimeline, LessonVideoProps } from "./lessonTypes";

// Remotion 根组件：注册所有合成
export const RemotionRoot: React.FC = () => {
  // 默认测试场景数据
  const defaultScenes = [
    {
      title: "提升效率的第一步",
      body: "使用 AI 工具可以让你的工作效率提升 10 倍",
      imageUrl: "",
      keywords: ["效率", "AI", "工具"],
    },
    {
      title: "自动化重复任务",
      body: "把重复性工作交给 AI，专注于创造性思维",
      imageUrl: "",
      keywords: ["自动化", "创意", "智能"],
    },
    {
      title: "数据分析更简单",
      body: "一句话描述需求，AI 帮你生成完整分析报告",
      imageUrl: "",
      keywords: ["数据", "分析", "报告"],
    },
  ];

  const defaultProps: ShortVideoProps = {
    scenes: defaultScenes,
    style: "tech",
    title: "5个提升效率的AI工具",
    brandName: "AI视频",
  };

  // 计算总帧数：开场2秒 + 每场景6秒
  const totalFrames = (2 + defaultScenes.length * 6) * 30;

  // 教学视频：时长由时间轴 JSON 决定，calculateMetadata 里动态算
  const emptyTimeline: LessonTimeline = {
    fps: 30,
    width: 1920,
    height: 1080,
    style: "lesson",
    title: "",
    sections: [],
    warnings: [],
  };
  const lessonProps: LessonVideoProps = { timeline: emptyTimeline };

  return (
    <>
      <Composition
        id="ShortVideo"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={ShortVideo as any}
        durationInFrames={totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => {
          // 动态计算时长
          const frames = (2 + (props as unknown as ShortVideoProps).scenes.length * 6) * 30;
          return { durationInFrames: frames };
        }}
      />

      <Composition
        id="LessonVideo"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={LessonVideo as any}
        durationInFrames={30}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={lessonProps}
        calculateMetadata={({ props }) => {
          const tl = (props as unknown as LessonVideoProps).timeline;
          const fps = tl.fps || 30;
          const TITLE = 3.5;
          const SECTION = 2.2;
          let sec = TITLE;
          for (const s of tl.sections) {
            if (s.title) sec += SECTION;
            for (const b of s.beats) {
              sec += b.durationSec + (b.quiz?.pauseSec ?? 0);
            }
          }
          return {
            durationInFrames: Math.max(1, Math.round(sec * fps)),
            width: tl.width || 1920,
            height: tl.height || 1080,
            fps,
          };
        }}
      />
    </>
  );
};