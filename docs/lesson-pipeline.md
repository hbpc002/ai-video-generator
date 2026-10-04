# 教学视频管线详解

教学视频和抖音短视频的架构差异见 [README](../README.md#两种视频模型的差异)。
本文只讲教学管线。

---

## 五个处理阶段

```
lesson JSON（人工可编辑，唯一需要干预的文件）
    │
    ├─① design-lesson.ts   课程设计        纯文本，不含代码      [需要 LLM]
    ├─② gen-manim.ts       Manim 代码      纯代码，不经 JSON    [需要 LLM]
    ├─③ edge_timeline.py   TTS + 词级时间戳
    ├─④ render_manim.py    Manim 片段渲染 + ffmpeg 时长对齐
    └─⑤ build-lesson-props.ts  preflight 校验 → Remotion props
    │
    └─→ Remotion render → MP4
```

**② 必须在 ③ 之后** —— 生成 Manim 代码需要词级时间戳来挑锚点，而时间戳来自 TTS。
所以 `gen-manim.ts` 的输入是**时间轴 JSON**，不是 `lesson JSON`。

Web UI 的「保存并出片」会自动按这个顺序串起来，无需手动管。

---

## 为什么拆成两次 LLM 调用

如果让模型一次生成「大纲 + 口播 + Manim 代码」，代码会以**转义字符串**的形式嵌在
JSON 里。模型对 `r"\text{}` / `r"a^2"` 这类内容的转义处理极易出错，而且这类 bug
极难定位 —— 表现为 JSON 解析失败，或者字符串里少了个反斜杠。

拆开后：
- **阶段①** 输出纯文本，模型只需遵循一个扁平 schema
- **阶段②** 直接写 Python 文件，不经 JSON 序列化

附带好处是两个阶段可以选不同模型：① 用便宜的国产模型（中文教学设计接地气），
② 用指令遵循更强的模型。

---

## Manim 自愈循环

模型对 Manim API 的首次正确率普遍只有 30–50%，所以**真正管用的是重试架构，
不是更强的模型**。

`gen-manim.ts` 的循环：

```
生成代码
  → manim -ql -s --format=png    单帧渲染，秒级返回
  → 成功：写回 sceneCode
  → 失败：extractManimError() 提取根因 → 喂回模型 → 重写
```

### 报错提取为什么是关键

Manim 用 rich 输出，日志里混着三类信息：

| 来源 | 位置 | 价值 |
|---|---|---|
| `ERROR <说明> <file>:<line>` + 续写 | **stdout** | 信息最准（LaTeX 报错在这） |
| `XxxError: message` | **stderr** | API 写错时只有这里有 |
| rich traceback 框 | stderr | 纯噪声，全是 `in render` / `in construct` |

两个实测踩到的坑：
- **只读 stderr 会丢掉根因**。中文公式漏 ctex 时，真正的
  `LaTeX Error: Unicode character 两 (U+4E24)` 在 stdout，只读 stderr 只能拿到
  没信息量的 `ValueError: latex error converting to dvi`
- **框线噪声占 90%**。111 行原始输出 → 11 行有效信息。不滤掉会占 token，
  也会把模型注意力从根因上带走

---

## 旁白驱动的动画

Manim 不知道音频有多长。社区通常按固定 `run_time` 写动画，必然和旁白错位。

`pipeline/manim_sync.py` 把词级时间戳包装成可等待的锚点：

```python
from manim import *
from manim_sync import narrator
from manim_theme import ACCENT, ACCENT_WARM, CjkTexTemplate, FONT_CJK_SERIF


class Pythagoras(Scene):
    def construct(self):
        n = narrator()

        tri = Polygon(A, B, C, color=ACCENT, stroke_width=6)
        self.play(Create(tri), run_time=1.2)      # 旁白一开口就在画

        n.wait_for(self, "直角三角形")              # 念到才贴标签
        n.wait_for(self, "斜边")                    # 念到才强调 c
        n.wait_for(self, "平方和")                  # 念到才写公式
        n.pad_to_audio(self, min_tail=0.5)         # 补齐到音频末尾
```

| API | 作用 |
|---|---|
| `wait_for(scene, 词)` | 等到旁白**念完**该词 |
| `wait_until(scene, 词)` | 等到旁白**开始**念该词 |
| `remaining(scene)` | 距音频结束还剩多少秒 |
| `pad_to_audio(scene, tail)` | 收尾，补齐，避免话讲完画面还在动 |

它是**死等**：场景时间超过锚点时立即返回，所以 TTS 变速不会卡死。
找不到关键词会打印警告并忽略，不会崩。

---

## lesson JSON 格式

`scripts/lesson-*.json` 是**唯一需要人工编辑的文件**，其余都是派生产物。

```jsonc
{
  "title": "勾股定理",
  "fps": 30, "width": 1920, "height": 1080,

  "sections": [{
    "title": "直角三角形的秘密",
    "beats": [{
      "narration": "勾股定理说，在直角三角形中，两条直角边的平方和，等于斜边的平方。",

      // 一个镜头内叠加的视觉层，各自按自己的锚点触发
      "visuals": [
        { "type": "diagram",  "at": "直角三角形", "layout": { "x": 27, "y": 46, "w": 34 } },
        { "type": "equation", "at": "平方和", "latex": "a^2+b^2=c^2",
          "reveal": "term-by-term", "layout": { "x": 70, "y": 44, "w": 46 } },
        { "type": "highlight", "at": "斜边", "target": "eq-main",
          "layout": { "x": 79, "y": 44, "w": 12 } }
      ],

      "quiz": { "question": "直角边是 6 和 8，斜边是多少？", "options": ["10","12","14"], "pauseSec": 4 }
    }]
  }]
}
```

### 关键约束

**`at` 必须原样出现在 `narration` 里**（连续 2–6 字，不能跨句，不能含标点）。

这是画面触发词。如果不在口播里，画面永远不出现 —— 而**视频照样能渲出来，
只是那段位置是空的**，很难在成片里一眼看出来。所以 preflight 会拦：

```
[error] 第1节/单元1/视觉2(equation) — 锚点「平方和」在口播里找不到，画面永远不会被触发
```

### 视觉类型

| type | 用途 | 附加字段 |
|---|---|---|
| `manim` | 几何 / 函数 / 公式推导 | `sceneCode`（由阶段②生成）、`intent` |
| `equation` | 单条公式，逐项浮现 | `latex`、`reveal: whole\|term-by-term` |
| `board` | 板书，手写逐字浮现 | `text`、`font: hand\|serif\|sans` |
| `diagram` | 图形，SVG 路径 draw-on | `svg`（内联 SVG 或 path d） |
| `list` | 要点列表，逐条点亮 | `items` |
| `highlight` | 聚光强调，到点退场 | `target` |
| `image` | 配图，Ken Burns | `imageUrl` |
| `video` | 情景短片（引子） | `src` |

`layout` 用**百分比**而非像素，横竖屏换分辨率不用改数值。
`manim` 类型忽略 `at` —— 它内部靠 `narrator.wait_for` 自行同步。

---

## 改完 JSON 必须重新生成时间轴

时间轴是派生产物。改了 `narration` 或 `at` 之后必须重跑：

```bash
npm run lesson:timeline -- scripts/lesson-xxx.json -o tmp/t.json
```

否则 `at` 的时间戳还是旧的，画面会错位。

改完想快速检查某一时���而不整段重渲：

```bash
cd video
npx remotion still src/index.ts LessonVideo out/f300.png \
  --props=props.json --frame=300 --scale=0.5     # 第 300 帧 ≈ 10 秒处
```

---

## 时长对齐

Manim 片段的长度由场景作者决定，跟旁白长度没有必然关系。三种情况：

| 情况 | 处理 |
|---|---|
| 片段 > 旁白 | ffmpeg 裁剪 |
| 片段 ≈ 旁白 | 直接用 |
| 片段 < 旁白 | ffmpeg `tpad=stop_mode=clone` 定格末帧补齐 |

**在 Python 侧做，而不是 Remotion 侧** —— 「定格末帧」用 `OffthreadVideo`
实现不可靠（要 seek、要处理缓冲）。在 ffmpeg 里一次定死后，Remotion 侧退化成
纯播放，简单得多。

---

## 约束与坑

**`BeatStage` 底色必须是纯色**，不能加渐变或色相漂移。Manim 片段渲染时用的是
同一个纯色背景（`render_manim.py --background`，默认 `#0f1117`），底色一变
片段边界就露馅。

**Manim 帧只有 14.2 单位宽**（x ∈ [-7.11, 7.11]，y ∈ [-4, 4]）。宽度不确定时
用 `.scale_to_fit_width(n)` 自适应，不要手调 `font_size` —— 换了分辨率会重新溢出。

**斜线旁的标签不能用 `next_to(line, RIGHT)`** —— 对斜线而言 RIGHT 指的是包围盒
右边缘，标签会飘到画面中间。正确做法是沿法线外推：

```python
mid = (B + C) / 2
outward = mid - (A + B + C) / 3
label.move_to(mid + outward / np.linalg.norm(outward) * 0.55)
```

**长课必须分片渲染**。15 分钟的课一次性渲，中途失败全废。

---

## API

Web UI 用的后端接口，也可以直接调：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/providers` | 列出提供商（含启停状态，密钥已抹除） |
| POST | `/api/providers` | 新增 |
| PUT/DELETE | `/api/providers/:id` | 改 / 删（内置不可删） |
| POST | `/api/providers/:id/toggle` | 厂商启停 |
| POST | `/api/providers/:id/models/:modelId/toggle` | 模型启停 |
| POST | `/api/providers/:id/discover` | 自动拉取模型 |
| POST | `/api/providers/:id/test` | 连通性测试（真发一次对话） |
| GET | `/api/lesson/files` | 列出课程 |
| GET/PUT | `/api/lesson/file` | 读取 / 保存（保存时返回校验结果） |
| POST | `/api/lesson/design` | 阶段① 作业 |
| POST | `/api/lesson/build` | 完整出片作业 |
| GET | `/api/lesson/job/:id` | 作业进度 + 日志 |

作业表在进程内存里，重启即丢。

---

## 验证脚本

```bash
npx tsx scripts/verify-toggle.ts     # 确认启停真正影响 resolveProvider
```

这个脚本的存在意义：UI 上的「停用」很容易只做成显示层过滤。这里验证的是
`resolveProvider` 会真的拒绝已停用的厂商和模型。

首次使用 `edge_timeline.py` 时应确认锚点解析正确：

```bash
npm run lesson:timeline -- scripts/lesson-manim.json -o tmp/t.json
python3 -c "
import json
tl = json.load(open('tmp/t.json'))
b = tl['sections'][0]['beats'][0]
print('时长', b['durationSec'], 's')
for w in b['words']: print(f\"  {w['start']:>6.3f}s {w['text']}\")
"
```