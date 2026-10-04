"""
Manim 场景的共用主题：中文公式模板 + 课程配色。

放在这里而不是让每个场景各自定义，有两个原因：

1. ctex 必须显式加载 —— MathTex 默认的 LaTeX 模板遇到中文直接报
   `LaTeX Error: Unicode character`，每个场景重写一遍模板太啰嗦。
2. 配色要和 video/src/lessonTypes.ts 的 LESSON_THEME 保持一致，
   否则 Manim 片段和 Remotion 图层放在一起会明显对不上。

注意：本模块 import manim，所以只能在装了 manim 的环境里 import
（也就是 pipeline/manim-venv）。render_manim.py 已经把它所在目录
放进 PYTHONPATH，场景代码直接 `from manim_theme import ...` 即可。
"""
from manim import TexTemplate

# ---- 中文公式模板 ----
# 系统依赖：apt-get install texlive-lang-chinese（提供 ctex 与 fandol 字体）
# 用法：MathTex(r"\text{斜边}", tex_template=CjkTexTemplate)


class CjkTexTemplate(TexTemplate):
    """在默认模板 preamble 里插入 ctex，让 \\text{} 能写中文。"""

    def __init__(self):
        super().__init__()
        self.preamble = r"\usepackage[UTF8]{ctex}" + self.preamble


def cjk(s: str, **kwargs):
    """写中文公式的语法糖：cjk(r"\text{两直角边}平方和=\text{斜边}平方")"""
    from manim import MathTex

    return MathTex(s, tex_template=CjkTexTemplate(), **kwargs)


# ---- 课程配色（与 video/src/lessonTypes.ts 的 LESSON_THEME 对齐） ----

ACCENT = "#4a9eff"    # 主色：图形主线、重点
ACCENT_WARM = "#ffb454"  # 暖色：当前强调项
BACKGROUND = "#0f1117"  # 底色，必须与 --background 一致，否则片段边界露馅
INK = "#1a2744"        # 板书墨色

# ---- 字体 ----
FONT_CJK_SERIF = "Noto Serif SC"
FONT_CJK_SANS = "Noto Sans SC"