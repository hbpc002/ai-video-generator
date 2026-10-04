#!/usr/bin/env python3
"""
教学视频旁白时间轴提取器。

用 Edge-TTS 一次性拿到「音频 + 词级时间戳」,把脚本里的 `at` 关键词锚点
解析成相对每个beat 起点的秒数,供 Remotion 换算成帧号。

关键点:
- WordBoundary 的 offset/duration 单位是 100纳秒 tick,需除以 1e7 得秒
- 音频和时间戳来自同一次 stream(),两者天然对齐,无需前导静音校正
- 关键词用「累计字符索引」反查所属词,支持多词短语(如 "平方和")
- 未命中的锚点写进 warnings,由 preflight 拦截,不静默失败
"""
import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("缺少依赖: pip install edge-tts")

TICK = 1e7  # 100ns ticks per second

VOICES = {
    "male": "zh-CN-YunyangNeural",
    "female": "zh-CN-XiaoxiaoNeural",
    "calm": "zh-CN-YunxiNeural",
}


async def synth_beat(text: str, voice: str, out_path: Path) -> dict:
    """生成一条旁白音频,同时收集词级时间戳。返回 words 列表。"""
    words = []
    audio = bytearray()

    comm = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    async for chunk in comm.stream():
        ctype = chunk["type"]
        if ctype == "audio":
            audio += chunk["data"]
        elif ctype == "WordBoundary":
            words.append(
                {
                    "text": chunk.get("text", ""),
                    "start": chunk.get("offset", 0) / TICK,
                    "end": chunk.get("offset", 0) / TICK
                    + chunk.get("duration", 0) / TICK,
                }
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(bytes(audio))
    return words


def probe_duration(path: Path) -> float:
    """用 ffprobe 读真实时长——Edge 输出的 48kbps 单声道质量太低,
    渲染前统一转高质量,最终以转码后的文件为准。"""
    out = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "csv=p=0", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def transcode_hq(src: Path, voice_pitch=None) -> Path:
    """Edge 默认输出 48kbps 单声道,转成 192kbps 立体声。"""
    dst = src.with_name(src.stem + "-hq" + src.suffix)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ar", "44100", "-ac", "2", "-b:a", "192k", str(dst)],
        capture_output=True, check=True,
    )
    return dst


def resolve_anchor(anchor: str, words: list) -> float | None:
    """把关键词解析成相对时间(秒)。

    策略:把所有词文本拼成整句,记录每个词的起始字符索引,再 find 锚点,
    反查出它落在哪个词里,按词内字符偏移比例插值。比「整词匹配」稳得多,
    因为 Edge 的中文分词不保证把 "平方和" 切成单独一个词。

    注意 frac 必须相对「命中词自己的 span」算,不能相对 spans[0]——
    后者是整个词表的首词,会让后面所有词的插值结果越界。
    """
    if not words:
        return None

    joined = ""
    spans = []  # (word_index, start_char, end_char)
    for i, w in enumerate(words):
        spans.append((i, len(joined), len(joined) + len(w["text"])))
        joined += w["text"]

    pos = joined.find(anchor)
    if pos < 0:
        return None

    end_pos = pos + len(anchor)

    # 锚点可能跨词(如 "直角" + "三角形"),取所有被覆盖词里最晚的时间点,
    # 保证视觉事件不会早于旁白念到。
    hits = [
        (words[i], s)
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

    # 跨词:取最后一个被覆盖词的结束时刻
    return hits[-1][0]["end"]


async def process(lesson: dict, voice: str, audio_dir: Path, out_path: Path) -> dict:
    warnings = []
    sections_out = []

    for si, section in enumerate(lesson.get("sections", [])):
        beats_out = []
        for bi, beat in enumerate(section.get("beats", [])):
            narration = beat.get("narration", "").strip()
            if not narration:
                warnings.append({
                    "level": "error", "section": si, "beat": bi,
                    "reason": "empty_narration",
                })
                beats_out.append({
                    "narration": "", "audioPath": "", "durationSec": 0.0,
                    "words": [], "events": [], "captions": [],
                })
                continue

            raw = audio_dir / f"s{si}-b{bi}.mp3"
            words = await synth_beat(narration, voice, raw)
            hq = transcode_hq(raw)
            duration = probe_duration(hq)

            # 解析视觉事件锚点
            events = []
            for ei, ev in enumerate(beat.get("visuals", [])):
                anchor = ev.get("at")
                start = resolve_anchor(anchor, words) if anchor else 0.0
                if anchor and start is None:
                    warnings.append({
                        "level": "error", "section": si, "beat": bi,
                        "anchor": anchor, "eventIndex": ei,
                        "reason": "anchor_not_found",
                        "hint": f"旁白里找不到「{anchor}」,该事件会落在0s",
                    })
                    start = 0.0
                # 锚点命中但时间落在旁白之外 → 说明音频比预期的短，
                # 事件永远不会被看到，静默丢弃会让排版出现空洞
                if start is not None and start > duration:
                    warnings.append({
                        "level": "error", "section": si, "beat": bi,
                        "anchor": anchor, "eventIndex": ei,
                        "reason": "anchor_beyond_audio",
                        "hint": (
                            f"「{anchor}」解析到 {start:.2f}s，"
                            f"但旁白只有 {duration:.2f}s，事件不会显示"
                        ),
                    })
                events.append({
                    **ev,
                    "id": ev.get("id") or f"s{si}b{bi}e{ei}",
                    "startSec": round(start or 0.0, 3),
                    "endSec": 0.0,   # 下面按「到下一个事件」回填
                    "resolved": bool(anchor and start is not None),
                })

            # 按 startSec 稳定排序后再回填 endSec。
# 不假设作者一定按旁白顺序书写 —— 写反了也应该正常工作，
# 否则 endSec 会变成负区间，视觉层提前消失。
            events.sort(key=lambda e: e["startSec"])

            # endSec = 到下一个事件的间隔；最后一个延伸到 beat 结束。
            # highlight 靠这个区间决定高亮持续多久。
            for ei in range(len(events) - 1):
                events[ei]["endSec"] = events[ei + 1]["startSec"]
            if events:
                events[-1]["endSec"] = round(duration, 3)

            # 字幕:未指定则跟随全部词(用词级时间戳,不经字符串查找)
            captions = beat.get("captions")
            resolved_caps = (
                captions_from_words(words)
                if captions is None
                else resolve_caption_anchors(captions, words)
            )

            beats_out.append({
                "narration": narration,
                "audioPath": hq.name,
                "durationSec": round(duration, 3),
                "words": words,
                "events": events,
                "captions": resolved_caps,
                "layout": beat.get("layout", "auto"),
                "quiz": beat.get("quiz"),
            })

        sections_out.append({
            "title": section.get("title", ""),
            "hookVideo": section.get("hookVideo"),
            "beats": beats_out,
        })

    result = {
        "fps": lesson.get("fps", 30),
        "width": lesson.get("width", 1920),
        "height": lesson.get("height", 1080),
        "style": lesson.get("style", "lesson"),
        "title": lesson.get("title", ""),
        "sections": sections_out,
        "warnings": warnings,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))

    total = sum(
        b["durationSec"]
        for s in sections_out
        for b in s["beats"]
    )
    print(f"✅ 时间轴已生成: {out_path}")
    print(f"   共 {sum(len(s['beats']) for s in sections_out)} 个 beat,"
          f"旁白总时长 {total:.1f}s")
    if warnings:
        print(f"\n⚠️  {len(warnings)} 条告警:")
        for w in warnings[:20]:
            loc = f"section {w.get('section')}/beat {w.get('beat')}"
            print(f"   [{w['level']}] {loc} {w.get('anchor','')} {w['reason']}"
                  f"{' — ' + w['hint'] if w.get('hint') else ''}")
    return result


def resolve_caption_anchors(captions: list, words: list) -> list:
    """字幕锚点。

    三种来源，优先级从高到低:
    1. cap.startSec  —— 直接给秒数
    2. cap.atWord     —— 按关键词在旁白里定位（与 visuals 同一策略）
    3. 无             —— startSec 留空，由渲染层回落到词级时间戳
    """
    out = []
    for cap in captions:
        if cap.get("startSec") is not None:
            start = float(cap["startSec"])
        elif cap.get("atWord"):
            start = resolve_anchor(cap["atWord"], words)
        else:
            start = None
        out.append({
            **cap,
            "text": cap.get("text") or cap.get("atWord", ""),
            "startSec": round(start, 3) if start is not None else None,
        })
    return out


def captions_from_words(words: list) -> list:
    """默认字幕：直接用词级时间戳，不走字符串查找。

    必须这么做 —— 旁白里同一个词可能重复出现（如两次「边」），
    字符串 find() 只会命中第一处，会导致后面所有字幕时间轴塌掉。
    """
    return [
        {"text": w["text"], "startSec": round(w["start"], 3), "wordIndex": i}
        for i, w in enumerate(words)
    ]


def main():
    ap = argparse.ArgumentParser(description="Edge-TTS 旁白时间轴提取")
    ap.add_argument("lesson", help="lesson JSON 路径")
    ap.add_argument("-o", "--out", default="lesson.timeline.json")
    ap.add_argument("--voice", default="male", choices=list(VOICES))
    ap.add_argument("--voice-name", help="直接指定 Edge 音色名,覆盖 --voice")
    ap.add_argument("--audio-dir", default="video/public/audio")
    args = ap.parse_args()

    lesson_path = Path(args.lesson)
    lesson = json.loads(lesson_path.read_text())
    voice = args.voice_name or VOICES[args.voice]

    # 项目根从本文件位置推导，这样不依赖调用时的工作目录
    root = Path(__file__).resolve().parent.parent
    audio_dir = root / args.audio_dir

    asyncio.run(process(lesson, voice, audio_dir, root / args.out))


if __name__ == "__main__":
    main()