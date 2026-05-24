#!/usr/bin/env node
/**
 * AI Video Generator CLI — Render Mode
 * 
 * Usage:
 *   node --import tsx generate.ts render <script.json> [--style tech|minimal|cute]
 *   node --import tsx generate.ts render <script.json> --tts [--tts-voice zh-CN-YunyangNeural]
 *   node --import tsx generate.ts render <slug>              # loads public/content/<slug>/script.json
 *
 * Reads a script.json file and renders it with Remotion.
 * Script generation is handled by Hermes agent (me).
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const PROJECT_ROOT = path.resolve(__dirname, ".");

interface SceneData {
  title: string;
  body: string;
  keywords: string[];
  imageUrl: string;
  imagePrompt?: string;
}

interface VideoScript {
  title: string;
  scenes: SceneData[];
}

type VideoStyle = "tech" | "minimal" | "cute";

function getSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// ---- TTS: 使用 Edge TTS (免费，无需 API key) ----
async function generateTTS(text: string, voice: string, outputPath: string): Promise<void> {
  console.log(`   生成语音: "${text.substring(0, 30)}..."`);
  const cmd = `edge-tts --voice "${voice}" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}" 2>/dev/null`;
  await execAsync(cmd);
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command("render <input>", "Render a script.json to video", (y) => {
      y.positional("input", {
        type: "string",
        describe: "Path to script.json or a slug name (looks in public/content/<slug>/)",
      });
    })
    .option("style", {
      alias: "s",
      type: "string",
      choices: ["tech", "minimal", "cute"] as const,
      default: "tech",
      description: "视觉风格",
    })
    .option("output", {
      alias: "o",
      type: "string",
      description: "输出视频路径（默认 output/<slug>.mp4）",
    })
    .option("concurrency", {
      alias: "c",
      type: "number",
      default: 8,
      description: "渲染并发数（默认 8，64 核机器建议 32-48）",
    })
    .option("fetch-images", {
      alias: "f",
      type: "boolean",
      default: false,
      description: "渲染前自动从免费图片 API 搜索配图（Pexels → Pixabay → Unsplash）",
    })
    .option("download-images", {
      alias: "d",
      type: "boolean",
      default: true,
      description: "将配图下载到本地后渲染（避免网络超时），配合 --fetch-images 使用",
    })
    .option("tts", {
      alias: "t",
      type: "boolean",
      default: false,
      description: "使用 Edge TTS 生成配音（免费，无需 API key）",
    })
    .option("tts-voice", {
      type: "string",
      default: "zh-CN-YunyangNeural",
      description: "TTS 语音（默认 zh-CN-YunyangNeural 男声）",
    })
    .option("no-render", {
      type: "boolean",
      default: false,
      description: "只保存脚本，不渲染视频（预览模式）",
    })
    .demandCommand(1, "请指定命令: render")
    .help()
    .alias("help", "h")
    .parse();

  const command = argv._[0] as string;

  if (command !== "render") {
    console.error(`未知命令: ${command}`);
    process.exit(1);
  }

  // `render <input>` — yargs stores positional in argv.input or argv._[1]
  const input = (argv.input as string) || (argv._[1] as string) || "";

  // ---- Resolve script.json ----
  let scriptPath: string;
  if (input.endsWith(".json")) {
    scriptPath = path.resolve(input);
  } else {
    // Treat as slug — look in public/content/<slug>/
    scriptPath = path.join(PROJECT_ROOT, "public", "content", input, "script.json");
  }

  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ 找不到脚本文件: ${scriptPath}`);
    process.exit(1);
  }

  const script: VideoScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));

  if (!script.scenes?.length) {
    console.error("❌ 脚本中没有场景数据");
    process.exit(1);
  }

  const style = argv.style!;
  const slug = getSlug(script.title);
  const outputPath = argv.output || path.join(PROJECT_ROOT, "output", `${slug}.mp4`);
  const useTTS = argv.tts as boolean;
  const ttsVoice = argv["tts-voice"] as string;

  console.log(`\n📹 AI 视频渲染器`);
  console.log(`═`.repeat(40));
  console.log(`标题: ${script.title}`);
  console.log(`场景: ${script.scenes.length}`);
  console.log(`风格: ${style}`);
  console.log(`配音: ${useTTS ? `✅ ${ttsVoice}` : "❌ 无"}`);
  console.log(`脚本: ${scriptPath}`);
  console.log(`═`.repeat(40));

  // Print scene preview
  console.log(`\n📋 场景预览:`);
  script.scenes.forEach((s, i) => {
    console.log(`  ${i + 1}. [${s.title}] ${s.body}`);
    console.log(`     关键词: ${s.keywords?.join(", ") || "无"}`);
  });

  if (argv["no-render"]) {
    console.log(`\n✅ 预览模式 — 脚本已验证，未渲染`);
    return;
  }

  // ---- Fetch images from free APIs ----
  if (argv["fetch-images"]) {
    console.log(`\n🖼️  正在搜索免费配图...`);
    const { fetchImagesForScenes } = await import(
      path.join(PROJECT_ROOT, "backend/src/services/image.ts")
    );
    script.scenes = await fetchImagesForScenes(script.scenes);
    console.log(`   配图完成`);
  } else {
    console.log(`\n`);
  }

  // ---- Download images to local (avoid network timeout during render) ----
  if (argv["fetch-images"] && argv["download-images"]) {
    console.log(`\n💾 正在下载配图到本地...`);
    const imagesDir = path.join(PROJECT_ROOT, "video", "public", "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    
    // 清除旧图片（避免缓存）
    const oldImages = fs.readdirSync(imagesDir).filter(f => f.startsWith("scene-"));
    for (const f of oldImages) {
      fs.unlinkSync(path.join(imagesDir, f));
    }
    if (oldImages.length > 0) {
      console.log(`   已清除 ${oldImages.length} 张旧图片`);
    }
    
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      if (scene.imageUrl) {
        const ext = path.extname(new URL(scene.imageUrl).pathname) || ".jpg";
        const localName = `scene-${i + 1}${ext}`;
        const localPath = path.join(imagesDir, localName);
        
        const response = await fetch(scene.imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(arrayBuffer));
        console.log(`   已保存: ${localName} (${(arrayBuffer.byteLength / 1024).toFixed(0)}KB)`);
        
        // Use public path for Remotion staticFile (no leading ./)
        scene.imageUrl = `images/${localName}`;
      }
    }
    console.log(`   本地图片准备完成\n`);
  }

  // ---- Generate TTS audio ----
  let audioPath = "";
  let sceneDurations: number[] = []; // 每个场景的音频时长（秒）
  if (useTTS) {
    console.log(`\n🎙️  正在生成 TTS 配音...`);
    console.log(`   语音: ${ttsVoice}`);
    
    const audioDir = path.join(PROJECT_ROOT, "tmp", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    
    const audioFiles: string[] = [];
    
    // 开场标题配音
    const introText = script.title;
    const introAudio = path.join(audioDir, "intro.mp3");
    await generateTTS(introText, ttsVoice, introAudio);
    audioFiles.push(introAudio);
    console.log(`   开场: "${introText}"`);
    
    // 每个场景的正文配音
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      const sceneAudio = path.join(audioDir, `scene-${i + 1}.mp3`);
      await generateTTS(scene.body, ttsVoice, sceneAudio);
      audioFiles.push(sceneAudio);
      console.log(`   场景 ${i + 1}: "${scene.body.substring(0, 30)}..."`);
    }
    
    // 合并所有音频
    audioPath = path.join(audioDir, "combined.mp3");
    const concatList = path.join(audioDir, "concat.txt");
    const listContent = audioFiles.map(f => `file '${f}'`).join("\n");
    fs.writeFileSync(concatList, listContent);
    
    console.log(`\n🔊 合并音频...`);
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${audioPath}" 2>/dev/null`);
    
    // edge-tts 默认输出质量太低 (48kbps 单声道)，需要转成高质量
    console.log(`\n🔊 提升音频质量...`);
    const audioHighQuality = path.join(audioDir, "combined-hq.mp3");
    await execAsync(`ffmpeg -y -i "${audioPath}" -ar 44100 -ac 2 -b:a 192k "${audioHighQuality}" 2>/dev/null`);
    
    const audioSize = (fs.statSync(audioHighQuality).size / 1024).toFixed(0);
    console.log(`   音频完成: ${audioHighQuality} (${audioSize}KB)`);
    audioPath = audioHighQuality;
    
    // ---- 获取每个音频的实际时长，用于动态计算视频帧数 ----
    console.log(`\n⏱️  获取音频时长...`);
    
    // 开场时长
    const introResult = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${introAudio}"`
    );
    const introDurationSec = parseFloat(introResult.stdout.trim());
    sceneDurations.push(introDurationSec);
    console.log(`   开场: ${introDurationSec.toFixed(2)}秒`);
    
    // 每个场景时长
    for (let i = 0; i < script.scenes.length; i++) {
      const sceneAudio = path.join(audioDir, `scene-${i + 1}.mp3`);
      const sceneResult = await execAsync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${sceneAudio}"`
      );
      const sceneDurationSec = parseFloat(sceneResult.stdout.trim());
      sceneDurations.push(sceneDurationSec);
      console.log(`   场景 ${i + 1}: ${sceneDurationSec.toFixed(2)}秒`);
    }
    
    const totalAudioSec = sceneDurations.reduce((a, b) => a + b, 0);
    console.log(`\n📊 音频总时长: ${totalAudioSec.toFixed(2)}秒`);
  }

  // ---- Render Video ----
  console.log(`\n🎬 开始渲染...`);

  const FPS = 30;
  
  // 根据音频时长动态计算视频帧数
  let totalFrames: number;
  if (useTTS && sceneDurations.length > 0) {
    // TTS 模式：视频时长 = 音频总时长
    const totalAudioSec = sceneDurations.reduce((a, b) => a + b, 0);
    totalFrames = Math.round(totalAudioSec * FPS);
    console.log(`   📐 动态时长模式：${sceneDurations.length} 个音频段`);
    sceneDurations.forEach((d, i) => {
      const label = i === 0 ? "开场" : `场景 ${i}`;
      console.log(`      ${label}: ${d.toFixed(2)}秒 → ${Math.round(d * FPS)} 帧`);
    });
  } else {
    // 无 TTS 模式：使用固定时长
    const introDuration = 4 * FPS;
    const sceneDuration = 6 * FPS;
    totalFrames = introDuration + script.scenes.length * sceneDuration;
    console.log(`   📐 固定时长模式：开场 4 秒 + ${script.scenes.length} 场景 × 6 秒`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  const bundled = await bundle({
    entryPoint: path.join(PROJECT_ROOT, "video/src/index.ts"),
    onProgress: (p: number) => {
      const bar = "█".repeat(Math.floor(p / 5)) + "░".repeat(20 - Math.floor(p / 5));
      process.stdout.write(`\r📦 打包中 [${bar}] ${Math.floor(p)}%`);
    },
  });
  console.log(); // newline

  const inputProps = {
    scenes: script.scenes,
    style,
    title: script.title,
    brandName: "AI 视频",
    sceneDurations: useTTS ? sceneDurations : undefined, // 传递音频时长用于动态场景切换
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "ShortVideo",
    inputProps,
  });

  // Override duration dynamically
  composition.durationInFrames = totalFrames;

  console.log(`🎯 ${totalFrames} 帧（约 ${Math.round(totalFrames / FPS)} 秒 @ ${FPS}fps）`);

  const startTime = Date.now();

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    concurrency: argv.concurrency ?? 8,
    onProgress: ({ progress }: { progress: number }) => {
      const pct = Math.floor(progress * 100);
      const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      process.stdout.write(`\r🎬 渲染中 [${bar}] ${pct}%`);
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n\n✅ 视频渲染完成! (${elapsed}秒)`);
  console.log(`📁 ${outputPath}`);
  console.log(`🎨 风格: ${style}`);
  console.log(`📝 标题: ${script.title}`);

  // ---- Merge audio with video ----
  if (useTTS && audioPath && fs.existsSync(audioPath)) {
    console.log(`\n🔊 合并音频与视频...`);
    const finalPath = outputPath.replace(".mp4", "-with-audio.mp4");
    
    // 获取视频时长
    const videoDurationResult = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`
    );
    const videoDuration = parseFloat(videoDurationResult.stdout.trim());
    
    // 获取音频时长
    const audioDurationResult = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`
    );
    const audioDuration = parseFloat(audioDurationResult.stdout.trim());
    
    console.log(`   视频时长: ${videoDuration.toFixed(1)}秒`);
    console.log(`   音频时长: ${audioDuration.toFixed(1)}秒`);
    
    // 如果音频比视频短，循环音频；如果长，截断音频
    // 使用 0.5 秒容差，避免浮点数精度问题
    const durationDiff = Math.abs(audioDuration - videoDuration);
    const EPSILON = 0.5;
    
    let audioInput = audioPath;
    if (durationDiff <= EPSILON) {
      // 时长基本一致（误差在 0.5 秒内）：直接合并
      console.log(`   ✅ 时长匹配，直接合并`);
    } else if (audioDuration < videoDuration) {
      // 音频太短，循环播放
      const loopCount = Math.ceil(videoDuration / audioDuration);
      const loopAudio = path.join(path.dirname(audioPath), "looped.mp3");
      await execAsync(`ffmpeg -y -i "${audioPath}" -filter_complex "aloop=loop=${loopCount}:size=2e+09" -c copy "${loopAudio}" 2>/dev/null`);
      audioInput = loopAudio;
      console.log(`   🔄 音频较短，循环 ${loopCount} 次`);
    } else {
      // 音频过长：将在合并时截断
      console.log(`   ✂️  音频较长，合并时截断`);
    }
    
    // 合并视频和音频
    // 关键修复：当音频比视频长时，用 -t 精确截断音频，避免 -shortest 导致的音质崩溃
    let ffmpegCmd: string;
    if (audioDuration > videoDuration) {
      // 音频过长：精确截断到视频时长
      ffmpegCmd = `ffmpeg -y -i "${outputPath}" -i "${audioInput}" -c:v copy -c:a aac -t ${videoDuration.toFixed(3)} -map 0:v:0 -map 1:a:0 "${finalPath}" 2>/dev/null`;
    } else if (audioDuration < videoDuration) {
      // 音频过短：已循环处理，直接合并
      ffmpegCmd = `ffmpeg -y -i "${outputPath}" -i "${audioInput}" -c:v copy -c:a aac -shortest "${finalPath}" 2>/dev/null`;
    } else {
      // 时长一致：直接合并，将 TTS 音频直接放入容器（MP3 在 MP4 中兼容性好）
      ffmpegCmd = `ffmpeg -y -i "${outputPath}" -i "${audioInput}" -c:v copy -c:a copy -map 0:v:0 -map 1:a:0 -movflags +faststart "${finalPath}" 2>/dev/null`;
    }
    await execAsync(ffmpegCmd);
    
    const finalSize = (fs.statSync(finalPath).size / 1024).toFixed(0);
    console.log(`\n✅ 最终视频: ${finalPath} (${finalSize}KB)`);
    console.log(`   (无配音版本: ${outputPath})`);
  }

  // Clean up temp audio files
  if (useTTS) {
    const audioDir = path.join(PROJECT_ROOT, "tmp", "audio");
    if (fs.existsSync(audioDir)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`\n❌ 错误:`, err.message || err);
  process.exit(1);
});
