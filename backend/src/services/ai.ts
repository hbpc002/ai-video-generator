import { chatJson, resolveProvider } from "../llm";
import { VideoScript, VideoStyle } from "../types";

// 抖音脚本生成。原先硬编码 Gemini（new GoogleGenAI + gemini-2.5-flash），
// 现已改走统一 provider 层：默认行为不变（有 GEMINI_API_KEY 就用 Gemini），
// 但可以换模型而不必改这个文件。

const getStyleDescription = (style: VideoStyle): string => {
  const styleMap = {
    tech: "科技感、未来感、蓝色主题、专业严谨",
    minimal: "简约风格、黑白配色、干净清爽、商务简洁",
    cute: "可爱风格、粉色主题、活泼有趣、亲切温暖",
  };
  return styleMap[style];
};

const SCRIPT_SCHEMA = {
  type: "object",
  required: ["title", "scenes"],
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "body", "keywords", "imagePrompt"],
        properties: {
          title: { type: "string", description: "场景标题，15 字以内" },
          body: { type: "string", description: "场景正文，20-40 字" },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "3 个关键词",
          },
          imagePrompt: {
            type: "string",
            description: "英文搜索词，用于 Unsplash 配图",
          },
        },
      },
    },
  },
};

/** 用结构化输出取代原来的正则抠JSON —— 少一层不确定性 */
const toScript = (raw: unknown): VideoScript => {
  const s = raw as VideoScript;
  if (!s?.title || !Array.isArray(s.scenes) || !s.scenes.length) {
    throw new Error(`模型返回的脚本结构不完整（title=${!!s?.title}, scenes=${s?.scenes?.length ?? 0}）`);
  }
  s.scenes = s.scenes.map((scene) => ({ ...scene, imageUrl: scene.imageUrl || "" }));
  return s;
};

/** 基于 URL 抓取的正文生成脚本 */
export async function generateVideoScriptFromContent(
  content: string,
  pageTitle: string,
  style: VideoStyle,
  sceneCount: number,
): Promise<VideoScript> {
  const prompt = `你是一个专业的短视频脚本创作者，专门为抖音/小红书创作竖屏短视频内容。

以下是一篇文章/网页的正文内容，请将其核心观点提炼成一个吸引人的短视频脚本。

文章标题：${pageTitle}
视频风格：${getStyleDescription(style)}
场景数量：${sceneCount}

原文内容：
---
${content}
---

要求：
1. 严格基于原文内容，不要编造不存在的信息
2. 每个场景提炼原文中一个核心观点
3. 每个场景标题简短有力（不超过15个字）
4. 每个场景正文简洁明了（20-40字），来自原文
5. 每个场景3个相关关键词
6. 每个场景提供一个英文图片搜索关键词（用于 Unsplash）`;

  const raw = await chatJson(
    resolveProvider(),
    [
      {
        role: "system",
        content:
          "你是短视频脚本创作者。只输出符合给定 schema 的 JSON，不要任何解释文字。",
      },
      { role: "user", content: prompt },
    ],
    { jsonSchema: SCRIPT_SCHEMA, temperature: 0.9 },
  );
  return toScript(raw);
}

/** 基于主题关键词生成脚本 */
export async function generateVideoScript(
  topic: string,
  style: VideoStyle,
  sceneCount: number,
): Promise<VideoScript> {
  const prompt = `你是一个专业的短视频脚本创作者，专门为抖音/小红书创作竖屏短视频内容。

请为以下主题创作一个短视频脚本：
主题：${topic}
视频风格：${getStyleDescription(style)}
场景数量：${sceneCount}

要求：
1. 每个场景有简短有力的标题（不超过15个字）
2. 每个场景正文简洁明了（20-40字）
3. 每个场景3个相关关键词
4. 每个场景提供一个英文图片搜索关键词（用于 Unsplash）
5. 内容吸引人，有传播价值`;

  const raw = await chatJson(
    resolveProvider(),
    [
      {
        role: "system",
        content:
          "你是短视频脚本创作者。只输出符合给定 schema 的 JSON，不要任何解释文字。",
      },
      { role: "user", content: prompt },
    ],
    { jsonSchema: SCRIPT_SCHEMA, temperature: 0.9 },
  );
  return toScript(raw);
}