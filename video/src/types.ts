// 视频场景数据类型
export interface SceneData {
  title: string;      // 场景标题
  body: string;       // 场景正文
  imageUrl: string;   // 背景图片 URL
  keywords: string[]; // 关键词标签
  imagePrompt?: string; // 图片搜索提示词（英文，更精准）
}

// 视频风格类型
export type VideoStyle = "tech" | "minimal" | "cute";

// 短视频合成属性
export interface ShortVideoProps {
  scenes: SceneData[];       // 所有场景数据
  style: VideoStyle;         // 视频风格
  title: string;             // 视频总标题
  brandName?: string;        // 品牌名称（水印用）
  sceneDurations?: number[]; // 可选：每个场景的音频时长（秒），用于动态场景切换
}
