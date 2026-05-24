# AI Video Generator

AI 短视频批量生成工具。输入脚本 → 自动配图 + 配音 → Remotion 渲染视频。

## 快速开始

```bash
# 安装依赖
npm run install:all

# 配置（可选，不配置也能用）
cp .env.example .env
# 编辑 .env 添加 API key（可选）

# 基础用法：渲染一个脚本
npm run gen render scripts/草船借箭.json --style tech

# 带配音渲染
npm run gen render scripts/草船借箭.json --style tech --tts

# 带配图 + 配音
npm run gen render scripts/草船借箭.json --style tech --tts --fetch-images
```

## 目录结构

```
ai-video-generator/
├── generate.ts          # CLI 主入口（渲染脚本为视频）
├── scripts/             # 脚本文件（.json），可直接渲染
├── output/              # 输出视频
├── frontend/            # React + Vite 前端界面
│   └── src/
│       ├── App.tsx
│       └── components/      # StyleSelector, ProgressCard
├── backend/             # Express API 服务
│   └── src/
│       ├── server.ts
│       ├── routes/
│       └── services/        # ai.ts（脚本生成）, image.ts（配图搜索）, render.ts（渲染）
├── video/               # Remotion 视频模板
│   └── src/
│       ├── Root.tsx
│       ├── compositions/    # ShortVideo.tsx（主合成）
│       └── components/      # Scene（场景）, Background（背景动画）, Animations（入场动画）
└── package.json         # npm workspaces monorepo
```

## 脚本格式（JSON）

在 `scripts/` 目录下创建 `.json` 文件，格式如下：

```json
{
  "title": "草船借箭：诸葛亮的智谋巅峰",
  "scenes": [
    {
      "title": "场景标题",
      "body": "场景正文内容，TTS 会朗读这段文字",
      "keywords": ["关键词1", "关键词2"],
      "imageUrl": "https://example.com/image.jpg",
      "imagePrompt": "English search keywords for Pexels API"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | ✅ | 视频总标题，用作开场画面和 TTS 开场配音 |
| `scenes[].title` | ✅ | 场景标题（不朗读，仅画面展示） |
| `scenes[].body` | ✅ | 场景正文，TTS 会朗读这段文字 |
| `scenes[].keywords` | ❌ | 关键词标签 |
| `scenes[].imageUrl` | ❌ | 背景图片 URL，留空则无背景图 |
| `scenes[].imagePrompt` | ❌ | 图片搜索提示词（英文），配合 `--fetch-images` 使用 |

> **建议：** 每个场景的 `body` 控制在 60-120 字，对应约 15-30 秒配音时长，观看体验最佳。

## CLI 命令

### 基础渲染

```bash
npm run gen render <script.json> [选项]
# 或直接用 tsx:
npx tsx generate.ts render <script.json> [选项]
```

### 选项

| 选项 | 别名 | 默认值 | 说明 |
|------|------|--------|------|
| `--style` | `-s` | `tech` | 视觉风格：`tech` / `minimal` / `cute` |
| `--tts` | `-t` | `false` | 开启 TTS 配音（免费，无需 API key） |
| `--tts-voice` | - | `zh-CN-YunyangNeural` | TTS 语音（中文推荐 `zh-CN-XiaoxiaoNeural` 女声） |
| `--fetch-images` | `-f` | `false` | 自动搜索免费配图 |
| `--download-images` | `-d` | `true` | 下载配图到本地后渲染（避免网络超时） |
| `--concurrency` | `-c` | `8` | 渲染并发数（64 核机器建议 32-48） |
| `--output` | `-o` | - | 输出路径（默认 `output/<slug>.mp4`） |
| `--no-render` | - | `false` | 仅验证脚本，不渲染视频 |

## TTS 配音

使用 **Microsoft Edge TTS**（免费，无需 API key）。

### 基本用法

```bash
npm run gen render scripts/草船借箭.json --tts
```

### 选择语音

```bash
# 女声（推荐）
npm run gen render scripts/草船借箭.json --tts --tts-voice zh-CN-XiaoxiaoNeural

# 男声 1
npm run gen render scripts/草船借箭.json --tts --tts-voice zh-CN-YunxiNeural

# 男声 2（默认）
npm run gen render scripts/草船借箭.json --tts --tts-voice zh-CN-YunyangNeural

# 台湾腔
npm run gen render scripts/草船借箭.json --tts --tts-voice zh-TW-HsiaoChenNeural

# 粤语
npm run gen render scripts/草船借箭.json --tts --tts-voice zh-HK-WanLungNeural

# 日语
npm run gen render scripts/草船借箭.json --tts --tts-voice ja-JP-NanamiNeural
```

### 配音特性

| 特性 | 说明 |
|------|------|
| **免费** | 完全免费，无需 API key |
| **音画同步** | 根据每个场景的语音时长自动调整画面长度 |
| **高质量** | 默认 48kbps → 自动提升为 **192kbps 立体声** |
| **超过 50 种语言** | 支持中文、英语、日语等 50+ 语言 |

> ⚠️ 首次使用需要安装 edge-tts：`pip install edge-tts`

## 视觉风格

三种视觉风格，含丰富的动画效果：

### tech（科技风 — 默认）
- 深蓝渐变背景
- 蓝紫色文字 + 霓虹蓝色强调
- 粒子动画 + 装饰环
- 适合科技、商业、知识类内容

### minimal（极简风）
- 深灰渐变背景
- 白色文字 + 浅灰强调
- 简洁的淡入淡出
- 适合沉稳、专业类内容

### cute（可爱风）
- 暗红粉渐变背景
- 粉红色文字 + 玫瑰红强调
- 柔和粒子动画
- 适合生活、美妆、情感类内容

### 动画效果

所有风格均包含：
- **每字入场动画** — 标题逐字弹出（带缩放和发光）
- **粒子系统** — 浮动粒子营造氛围
- **装饰环** — 旋转发光圆环
- **渐变背景** — 场景自适应渐变背景
- **场景过渡** — 平滑切换

## 配图

### 自动搜索图片

```bash
npm run gen render scripts/xxx.json --style tech --tts --fetch-images
```

自动从以下免费 API 搜索配图（按优先级）：
1. **Pexels**（推荐，每月 200 次免费请求）
2. **Pixabay**（每小时 5000 次免费请求）
3. **Unsplash**（每月 50K 次，需署名）

需在 `.env` 中配置 API key 以获得更高质量的结果：
```env
PEXELS_API_KEY=your_key_here
PIXABAY_API_KEY=your_key_here
UNSPLASH_ACCESS_KEY=your_key_here
```

### 图片搜索提示（imagePrompt）

在脚本中添加 `imagePrompt`（**英文**）可以获得更精准的图片搜索：
```json
{
  "imagePrompt": "ancient Chinese warships, river fog, Three Kingdoms era"
}
```

## 音画同步原理

视频渲染采用 **音频优先** 的工作流程：

```
1. TTS 生成每个场景的音频
2. 测量每个音频的实际时长
3. 按音频时长计算视频帧数
4. 渲染视频（画面时长 = 语音时长）
5. 合并音视频
```

无需 TTS 时使用固定时长（开场 4 秒 + 每场景 6 秒）。

## 完整使用示例

```bash
# 1. 最简渲染（无配音、无配图）
npm run gen render scripts/草船借箭.json

# 2. 带配音
npm run gen render scripts/草船借箭.json --tts

# 3. 带配音 + 配图
npm run gen render scripts/草船借箭.json --tts --fetch-images

# 4. 指定风格 + 女声
npm run gen render scripts/草船借箭.json --style cute --tts --tts-voice zh-CN-XiaoxiaoNeural

# 5. 指定输出路径
npm run gen render scripts/草船借箭.json --tts --output /home/my-video.mp4

# 6. 快速渲染（64 核机器提高并发）
npm run gen render scripts/草船借箭.json --tts --concurrency 48

# 7. 仅预览脚本（不渲染）
npm run gen render scripts/草船借箭.json --no-render
```

## 输出文件

- **无配音视频**：`output/<slug>.mp4`
- **带配音视频**：`output/<slug>-with-audio.mp4`
- **规格**：1080×1920，30fps，H.264，AAC 音频

## 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 必装 |
| ffmpeg | 推荐 4.4+ | 音频处理，必装 |
| edge-tts | pip install | TTS 配音（选装） |
| Gemini API key | - | AI 脚本生成（选装） |

### ffmpeg 安装

```bash
# Ubuntu / Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# 验证
ffmpeg -version
```

### edge-tts 安装

```bash
pip install edge-tts
# 验证
edge-tts --help
```

## 常见问题

### Q: 视频没有声音？
A: 使用 `--tts` 参数生成配音。如果已有配音但听不到，检查 ffmpeg 是否安装。

### Q: 画面和声音不同步？
A: 系统已自动处理 — 每个场景的画面时长跟随语音长度动态调整，无需手动设置。

### Q: 如何换配音声音？
A: 使用 `--tts-voice` 参数选择不同语音，参见上方"选择语音"章节。

### Q: 配图没有搜到？
A: 在脚本中添加 `imagePrompt`（英文提示词）可以让搜索更精准。也可以在 `.env` 中配置 Pexels/Pixabay API key。

### Q: 渲染太慢？
A: 增加并发数：`--concurrency 32`（64 核机器可以用 48）。

### Q: 如何只渲染不配音？
A: 不加 `--tts` 参数即可。

### Q: 临时音频文件在哪？
A: `tmp/audio/` 目录，每次渲染后自动清理。

## API 服务

项目还包含一个 Web 界面：

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

### API 端点

```http
POST /api/generate
  Body: { topic, style: "tech"|"minimal"|"cute", scenes: number }
  Response: { jobId }

GET /api/job/:jobId
  Response: { status, progress, videoUrl?, script? }

GET /api/download/:jobId
  Response: mp4 file
```

## License

MIT