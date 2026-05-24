import { SceneData } from "../types";

// ============================================
// 免费图片 API 服务 — 自动 fallback 链
// ============================================
// 支持三个免费 API，按优先级尝试，任一成功即可
// 优先级: Pexels > Pixabay > Unsplash
// ============================================

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || "";
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || "";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

// 图片搜索结果类型
interface ImageResult {
  url: string;
  provider: "pexels" | "pixabay" | "unsplash";
}

// ---- Pexels API (https://www.pexels.com/api/) ----
// 免费: 每月 200 次请求，无需署名
async function fetchPexelsImage(query: string): Promise<string | null> {
  if (!PEXELS_API_KEY) return null;

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=1&orientation=portrait`;
    const res = await fetch(url, {
      headers: {
        Authorization: PEXELS_API_KEY,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data?.photos?.[0];
    if (photo?.src?.original) {
      return photo.src.original;
    }
    // Fallback to smaller size
    return photo?.src?.large2x || photo?.src?.large || null;
  } catch {
    return null;
  }
}

// ---- Pixabay API (https://pixabay.com/api/docs/) ----
// 免费: 每小时 5000 次请求，无需署名
async function fetchPixabayImage(query: string): Promise<string | null> {
  if (!PIXABAY_API_KEY) return null;

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodedQuery}&image_type=photo&orientation=vertical&per_page=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.hits?.[0];
    if (hit?.largeImageURL) {
      return hit.largeImageURL;
    }
    return hit?.webformatURL || hit?.largeImageURL || null;
  } catch {
    return null;
  }
}

// ---- Unsplash API (https://unsplash.com/developers) ----
// 免费: 每月 5 万次请求，需注明作者
async function fetchUnsplashImage(query: string): Promise<string | null> {
  if (!UNSPLASH_ACCESS_KEY) return null;

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.unsplash.com/photos/random?query=${encodedQuery}&orientation=portrait&client_id=${UNSPLASH_ACCESS_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.urls?.regular || data?.urls?.small || null;
  } catch {
    return null;
  }
}

// ---- 主函数: 自动 fallback 链 ----
async function fetchImageWithFallback(query: string): Promise<ImageResult | null> {
  // 1. 尝试 Pexels (首选)
  let url = await fetchPexelsImage(query);
  if (url) return { url, provider: "pexels" };

  // 2. 尝试 Pixabay
  url = await fetchPixabayImage(query);
  if (url) return { url, provider: "pixabay" };

  // 3. 尝试 Unsplash
  url = await fetchUnsplashImage(query);
  if (url) return { url, provider: "unsplash" };

  return null;
}

// ---- 为所有场景获取配图 ----
export async function fetchImagesForScenes(scenes: SceneData[]): Promise<SceneData[]> {
  console.log(`\n🔍 正在为 ${scenes.length} 个场景搜索配图...`);
  console.log(`   (尝试 Pexels → Pixabay → Unsplash 免费 API)`);

  const updatedScenes = await Promise.all(
    scenes.map(async (scene, index) => {
      const prompt = scene.imagePrompt || scene.title;
      console.log(`   [${index + 1}/${scenes.length}] "${prompt}" ...`);

      const result = await fetchImageWithFallback(prompt);

      if (result) {
        console.log(`   ✅ ${result.provider}: ${result.url.slice(0, 60)}...`);
        return { ...scene, imageUrl: result.url };
      } else {
        console.log(`   ⚠️  未找到图片（所有 API 均无结果或不可用）`);
        return { ...scene, imageUrl: "" };
      }
    })
  );

  const successCount = updatedScenes.filter(s => s.imageUrl).length;
  console.log(`\n📊 配图结果: ${successCount}/${scenes.length} 成功`);

  return updatedScenes;
}

// ---- 单个场景获取图片（供 CLI 直接调用）----
export async function fetchImageForScene(scene: SceneData): Promise<SceneData> {
  const prompt = scene.imagePrompt || scene.title;
  const result = await fetchImageWithFallback(prompt);
  return { ...scene, imageUrl: result?.url || "" };
}
