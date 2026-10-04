# AI Video Generator

用 AI 生成两类视频：**抖音竖屏短视频** 和 **分层教学视频**。

两者共用一套 LLM provider 层和 Remotion 渲染管线，但视频模型完全不同 ——
这不是配置差异，而是架构差异（见下节）。

---

## 两种视频模型的差异

这是理解本项目的关键。抖音视频和教学视频**不能用同一套数据结构**：

| | 抖音短视频 | 教学视频 |
|---|---|---|
| 最小单元 | 一个分句 | 一个**连续讲解**（beat） |
| 画面结构 | 一图到底 | 板书 / 公式 / 图形 / 聚光**分层叠加** |
| 音画对齐粒度 | **镜头级** | **词级** |
| 时长 | 30–60s | 8–15 min |
| 典型场景 | 解说、文案 | 课程、科普 |

教学视频的对齐精度必须到词：旁白念到「平方和」时公式才浮现，晚半秒就失去意义。
所以教学管线用 Edge-TTS 的 `WordBoundary` 拿词级时间戳，把脚本里的关键词锚点
换算成帧号，Manim 片段内部则通过 `narrator.wait_for("平方和")` 自行同步。

→ 教学管线完整文档见 **[docs/lesson-pipeline.md](docs/lesson-pipeline.md)**

---

## 安装

### 通用依赖

```bash
npm run install:all
cp .env.example .env      # 可选，抖音链路不配也能跑
```

还需要系统级 `ffmpeg`：

```bash
apt-get install -y ffmpeg
```

### 教学管线的额外依赖

只有走教学视频时才需要。

**1. LaTeX**（Manim 的 `MathTex` 依赖它，没有会直接报错）

```bash
apt-get install -y texlive-latex-extra texlive-fonts-recommended \
                   texlive-latex-recommended dvisvgm texlive-lang-chinese
```

`texlive-lang-chinese` 提供 ctex 和中文字体。**公式里要写中文必须显式注入模板**，
默认模板遇到中文会报 `LaTeX Error: Unicode character`：

```python
from manim_theme import CjkTexTemplate
MathTex(r"\text{两直角边的平方和}", tex_template=CjkTexTemplate())
```

**2. Manim**（装在独立 venv，不污染系统 Python —— 抖音链路的 edge-tts 在系统 Python 里）

```bash
python3 -m venv pipeline/manim-venv
pipeline/manim-venv/bin/pip install manim
```

装好后 `npx tsx pipeline/design-lesson.ts --list` 会显示 Manim 状态。

---

## 快速开始

### Web UI（推荐）

```bash
npm run build --workspace=frontend
cd backend && npx tsx src/server.ts
```

打开 `http://localhost:3001`，顶部三个页签：

| 页签 | 作用 |
|---|---|
| **抖音短视频** | 主题/URL → 竖屏成片 |
| **教学视频** | 课程设计 → 编辑校验 → 出片 |
| **模型管理** | 提供商增删改启停、自动拉取模型、连通性测试 |

> 后端是前台进程。shell 超时或断开会杀掉它，用后台方式跑：
> `setsid nohup npx tsx src/server.ts > /tmp/be.log 2>&1 < /dev/null &`

### CLI

```bash
# 抖音短视频
npm run gen render scripts/草船借箭.json --style tech --tts --fetch-images

# 教学视频（全自动，需要配 LLM key）
# 注意顺序：先生成时间轴（③）再写 Manim 代码（②），
# 因为代码生成需要词级时间戳来挑锚点
npm run lesson:design   -- --topic "勾股定理" --grade 初中 --beats 6
npm run lesson:timeline -- scripts/lesson-勾股定理.json -o tmp/t.json
npm run lesson:code     -- tmp/t.json --attempts 3
npm run lesson:manim    -- tmp/t.json --quality h
npm run lesson:props    -- tmp/t.json video/props.json
cd video && npx remotion render src/index.ts LessonVideo out/lesson.mp4 --props=props.json
```

也可以从现成示例课开始（**不需要任何 LLM key**）：

```bash
npm run lesson:timeline -- scripts/lesson-混合示例.json -o tmp/demo.json
npm run lesson:props    -- tmp/demo.json video/demo-props.json
cd video && npx remotion render src/index.ts LessonVideo out/demo.mp4 \
  --props=demo-props.json --scale=0.5   # --scale=0.5 为半分辨率试渲
```

---

## 配置 LLM

一个适配器覆盖 11 家厂商。优先级：**UI 保存的配置 > 环境变量 > 内置默认**。

在「模型管理」页填最省事；也可以只配 `.env`：

```bash
DEEPSEEK_API_KEY=sk-xxx     # 阶段①课程设计：中文教学设计性价比高，推荐
GEMINI_API_KEY=xxx          # 阶段② Manim 代码：结构化输出最稳
ANTHROPIC_API_KEY=xxx       # 阶段② 备选，指令遵循强
```

两个阶段**可以用不同模型** —— 这是把生成拆成两步的额外好处。

配置落盘在 `config/providers.json`（已 gitignore）。密钥优先从环境变量读
（UI 里的「环境变量名」字段），避免明文落盘。

查看就绪状态：

```bash
npx tsx pipeline/design-lesson.ts --list
```

---

## 目录结构

```
ai-video-generator/
├── generate.ts              # 抖音链路 CLI 入口
├── pipeline/                # 教学管线（全部处理步骤）
│   ├── edge_timeline.py     #   TTS + 词级时间戳 + 锚点解析
│   ├── manim_sync.py        #   narrator.wait_for：旁白驱动 Manim 动画
│   ├── manim_theme.py       #   ctex 模板 + 课程配色
│   ├── render_manim.py      #   Manim 片段渲染编排（带 ffmpeg 时长对齐）
│   ├── design-lesson.ts     #   阶段①课程设计（纯文本，不含代码）
│   ├── gen-manim.ts         #   阶段②场景代码生成（带渲染自愈）
│   └── build-lesson-props.ts#   preflight 校验 + Remotion props
├── scripts/                 # 课程 JSON（唯一需要人工编辑的文件）
├── backend/
│   └── src/
│       ├── llm/             # provider 层：4 类协议适配 + store + 自动发现
│       ├── lesson/          # 教学数据结构与校验（Web 与 CLI 共用）
│       └── routes/          # generate（抖音）/ lesson / providers
├── frontend/src/pages/      # LessonStudio, ProviderAdmin
├── video/                   # Remotion
│   └── src/
│       ├── compositions/    #   ShortVideo（抖音）/ LessonVideo（教学）
│       └── components/lesson/  # VisualEventLayer, ManimLayer, formula
└── package.json             # npm workspaces monorepo
```

---

## 常见问题

**Q: 视频没有声音？**
抖音链路检查是否加了 `--tts`；ffmpeg 是否装了。

**Q: 画面和声音不同步？**
教学管线里 `edge_timeline.py` 用 ffprobe 读真实音频时长，不是估算值。
如果仍然错位，检查是否手动改过 `lesson JSON` 的 `at` 锚点而没重新跑
`lesson:timeline` —— 时间轴是派生产物，改完 JSON 必须重新生成。

**Q: Manim 报 `LaTeX Error: Unicode character`？**
公式里写了中文但没走 `CjkTexTemplate`。见「安装」一节。

**Q: Manim 报 `find not found: latex`？**
LaTeX 没装。`apt-get install texlive-latex-extra dvisvgm`。

**Q: Manim 内容被裁掉？**
Manim 默认帧只有 14.2 单位宽（x ∈ [-7.11, 7.11]）。宽度不确定时用
`.scale_to_fit_width(n)` 自适应，不要手调 `font_size`。

**Q: Manim 片段和画面底色交界处有一条线？**
`BeatStage` 的底色必须是纯色，不能加渐变或色相漂移 —— Manim 片段渲染时
用的是同一个纯色背景（`render_manim.py --background`），底色一变就露馅。

**Q: 阶段①报「锚点找不到，画面永远不会被触发」？**
这是最常见的失败。模型给的 `at` 不在 `narration` 里，画面永远不出现 ——
而视频照样能渲出来，只是那段位置是空的。preflight 会拦下并指出具体是哪一节
哪一条，按提示改 `narration` 或换 `at` 即可。

**Q: 连通性测试显示「空回复」？**
推理模型（如 AMD ROCm 的 Qwen3.8-27B）会把 token 花在推理上，`content`
返回空。这是正常行为，不是模型不可用 —— UI 会标为「可用（空回复）」。

**Q: 拉取模型失败？**
部分厂商关闭了模型列举接口。用「+ 手动添加」填模型 id 即可。

**Q: 渲染太慢？**
Manim 片段用 `-qh`（1080p60），11s 片段约 14s。Remotion 全片渲染
1080p30 一分钟视频约 1 分钟。试渲加 `--scale=0.5`。

---

## 抖音短视频工具

以下为原有的抖音链路文档。## 快速开始

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

### 目录结构

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

### 脚本格式（JSON）

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

### CLI 命令

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

### TTS 配音

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

### 视觉风格

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

### 配图

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

### 音画同步原理

视频渲染采用 **音频优先** 的工作流程：

```
1. TTS 生成每个场景的音频
2. 测量每个音频的实际时长
3. 按音频时长计算视频帧数
4. 渲染视频（画面时长 = 语音时长）
5. 合并音视频
```

无需 TTS 时使用固定时长（开场 4 秒 + 每场景 6 秒）。

### 完整使用示例

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

### 输出文件

- **无配音视频**：`output/<slug>.mp4`
- **带配音视频**：`output/<slug>-with-audio.mp4`
- **规格**：1080×1920，30fps，H.264，AAC 音频

### 前置要求

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

### 常见问题

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

### API 服务

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

### License

MIT