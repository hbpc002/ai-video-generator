"""
让 Manim 场景跟着旁白节奏走的同步助手。

背景:Manim 不知道音频有多长、旁白什么时候念到哪个词。
如果按固定 run_time 写动画,必然和旁白错位 —— 这是社区里反复出现的问题。
这里把 edge_timeline.py 产出的词级时间戳喂给 Manim,
让场景作者用 `narrator.wait_for(self, "平方和")` 表达"念到这儿再动"。

用法(在生成的 scene.py 里):

    from manim import *
    from manim_sync import narrator

    class MyScene(Scene):
        def construct(self):
            n = narrator()          # 从 MANIM_SYNC_JSON 环境变量读时间轴
            tri = Triangle()
            self.play(Create(tri), run_time=1.0)
            n.wait_for(self, "直角三角形")
            self.play(Write(MathTex(r"a^2+b^2=c^2")))
            n.wait_for(self, "平方和")
            self.wait_until(self, "斜边")

同步文件格式(由 pipeline/edge_timeline.py 的 resolve 逻辑产出):

    {"durationSec": 6.5, "words": [{"text": "...", "start": 1.5, "end": 2.4}]}

本模块刻意不 import manim,只做时间计算 —— 这样它在任何 Python 环境都能 import。
"""
import json
import os
from pathlib import Path

SYNC_ENV = "MANIM_SYNC_JSON"


class Narrator:
    """把旁白时间轴包装成 Manim 可等待的锚点。"""

    def __init__(self, duration_sec: float, words: list):
        self.duration = duration_sec
        self.words = words
        self._warned: set = set()

    # ---- 查找 ----

    def _find(self, keyword: str):
        """和 edge_timeline.py 同样的策略:拼整句再反查所属词。

        必须和解析侧保持一致,否则这里算出的时刻和字幕对不上。
        """
        if not self.words:
            return None

        joined = ""
        spans = []
        for i, w in enumerate(self.words):
            spans.append((i, len(joined), len(joined) + len(w["text"])))
            joined += w["text"]

        pos = joined.find(keyword)
        if pos < 0:
            return None
        end_pos = pos + len(keyword)

        hits = [
            (self.words[i], s)
            for i, s, e in spans
            if e > pos and s < end_pos
        ]
        if not hits:
            return None

        if len(hits) == 1:
            w, span_start = hits[0]
            frac = (pos - span_start) / max(1, len(w["text"]))
            frac = max(0.0, min(1.0, frac))
            return w["start"] + (w["end"] - w["start"]) * frac

        return hits[-1][0]["end"]

    def time_of(self, keyword: str):
        """返回该关键词在旁白里的时刻(秒)。找不到返回 None。"""
        t = self._find(keyword)
        if t is None and keyword not in self._warned:
            self._warned.add(keyword)
            print(
                f"[manim_sync] ⚠️  旁白里找不到「{keyword}」，"
                f"该锚点被忽略。旁白原文：{''.join(w['text'] for w in self.words)}"
            )
        return t

    # ---- 等待 ----

    def wait_for(self, scene, keyword: str, min_wait: float = 0.0):
        """等到旁白念完 keyword（或场景已超过该时刻）再继续。

        已经是死等 —— 场景时间超过锚点时立即返回,
        所以不会因为 TTS 变速而卡死。
        """
        target = self.time_of(keyword)
        if target is None:
            return False
        gap = target - scene.renderer.time
        if gap > min_wait:
            scene.wait(gap)
        return True

    def wait_until(self, scene, keyword: str):
        """等到旁白刚开始念 keyword（即该词起点）。"""
        t = self.time_of(keyword)
        if t is None:
            return False
        gap = t - scene.renderer.time
        if gap > 0:
            scene.wait(gap)
        return True

    def remaining(self, scene) -> float:
        """距离旁白结束还剩多少秒。

        用它收尾:self.wait(n.remaining(self)) 让动画正好停在音频末尾,
        避免出现"话讲完了画面还在动"。
        """
        return max(0.0, self.duration - scene.renderer.time)

    def pad_to_audio(self, scene, min_tail: float = 0.4):
        """补齐到音频结束 —— 在 hold_final 场景里替代固定 self.wait()。"""
        gap = self.remaining(scene) - min_tail
        if gap > 0:
            scene.wait(gap)


def narrator(sync_path: str | None = None) -> Narrator:
    """构造 Narrator。

    同步文件优先从参数读,其次从 MANIM_SYNC_JSON 环境变量读。
    都没有时返回空时间轴,这样 scene.py 在本地调试时也能直接跑。
    """
    path = sync_path or os.environ.get(SYNC_ENV)
    if not path:
        return Narrator(0.0, [])

    p = Path(path)
    if not p.exists():
        print(f"[manim_sync] ⚠️  同步文件不存在: {p}，按无同步处理")
        return Narrator(0.0, [])

    data = json.loads(p.read_text())
    return Narrator(
        duration_sec=data.get("durationSec", 0.0),
        words=data.get("words", []),
    )