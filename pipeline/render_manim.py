#!/usr/bin/env python3
"""
Manim 片段编排器。

读 edge_timeline.py 产出的时间轴，找出带 manim 视觉层的 beat，
用该 beat 的词级时间戳驱动 Manim 场景渲染出与课程底色同色的 mp4，
再把片段路径和时长写回时间轴，交给 Remotion 合成。

顺序很重要：必须在 edge_timeline.py 之后跑（需要词级时间戳做 wait_for 同步），
在 build-lesson-props 之前跑（需要把 clipPath 写进 props）。

用法:
    python3 pipeline/render_manim.py tmp/lesson.timeline.json \
        --quality h --out-dir video/public/manim
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ROOT / "pipeline"
DEFAULT_MANIM = PIPELINE_DIR / "manim-venv" / "bin" / "manim"

QUALITY = {
    "l": ("-ql", "854x480, 15fps"),
    "m": ("-qm", "1280x720, 30fps"),
    "h": ("-qh", "1920x1080, 60fps"),
}


def find_manim() -> str:
    """优先用项目内 venv 的 manim，避免污染系统 Python。"""
    if DEFAULT_MANIM.exists():
        return str(DEFAULT_MANIM)
    found = shutil.which("manim")
    if found:
        return found
    sys.exit(
        "找不到 manim。请先安装:\n"
        "  python3 -m venv pipeline/manim-venv\n"
        "  pipeline/manim-venv/bin/pip install manim\n"
        "并确保已装 LaTeX（MathTex 需要）：\n"
        "  apt-get install -y texlive-latex-extra dvisvgm"
    )


def render_one(
    manim_bin: str,
    scene_code: str,
    class_name: str,
    sync_data: dict,
    beat_id: str,
    out_dir: Path,
    quality: str,
    transparent: bool,
    target_sec: float,
    background: str,
) -> dict:
    """渲染单个 Manim 场景,返回 {path, durationSec}。"""
    flag = QUALITY[quality][0]

    with tempfile.TemporaryDirectory(prefix=f"manim-{beat_id}-") as tmp:
        work = Path(tmp)
        scene_file = work / "scene.py"

        # 注入 preamble：把背景色设成课程主题底色。
        # 用 opaque mp4 而不是透明通道 —— Manim 带 --transparent 会强制改用
        # ProRes 4444 的 .mov（为了保 alpha），后续处理麻烦得多；
        # 而课程底色本来就是纯色，渲成同色即可无缝衔接。
        preamble = (
            "# ---- injected by pipeline/render_manim.py ----\n"
            "import manim as _manim\n"
            f"_manim.config.background_color = {background!r}\n"
            "_manim.config.background_opacity = 1.0\n"
            "# ---- end injected ----\n\n"
        )
        scene_file.write_text(preamble + scene_code, encoding="utf-8")

        sync_file = work / "sync.json"
        sync_file.write_text(json.dumps(sync_data, ensure_ascii=False), encoding="utf-8")

        env = dict(os.environ)
        # 让 scene.py 能 import manim_sync
        env["PYTHONPATH"] = str(PIPELINE_DIR) + os.pathsep + env.get("PYTHONPATH", "")
        # 告诉 Narrator 去哪读时间轴
        env["MANIM_SYNC_JSON"] = str(sync_file)

        cmd = [
            manim_bin, flag,
            *(["--transparent"] if transparent else []),
            "--media_dir", str(work / "media"),
            "-o", beat_id,
            str(scene_file), class_name,
        ]

        proc = subprocess.run(
            cmd, capture_output=True, text=True, env=env, cwd=str(work),
        )

        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-12:]
            raise RuntimeError(
                f"Manim 渲染失败 ({class_name}):\n" + "\n".join(tail)
            )

        # transparent 模式下 Manim 会无视格式、改出 .mov，所以两种都收
        produced = list((work / "media").rglob("*.mp4")) or \
                   list((work / "media").rglob("*.mov"))
        if not produced:
            raise RuntimeError(f"Manim 未产出视频 ({class_name})")

        out_dir.mkdir(parents=True, exist_ok=True)
        raw = out_dir / f"{beat_id}.raw.mp4"
        shutil.copy(produced[0], raw)

    # 精确对齐到旁白时长（外部函数，不在 with 块内）
    final = out_dir / f"{beat_id}.mp4"
    res = fit_to_audio(raw, target_sec=target_sec, dst=final)
    raw.unlink(missing_ok=True)
    return res


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def fit_to_audio(src: Path, target_sec: float, dst: Path) -> dict:
    """把片段时长精确对齐到旁白时长。

    短 → tpad 定格末帧补齐；长 → 直接裁。
    在这里做而不是在 Remotion 里做，是因为「定格末帧」用
    OffthreadVideo 实现不可靠（要 seek、要处理缓冲），一次性在
    ffmpeg 里定死，Remotion 侧就退化成纯播放，简单得多。
    """
    cur = probe_duration(src)
    cmd = ["ffmpeg", "-y", "-i", str(src)]

    if cur < target_sec - 0.02:
        pad = target_sec - cur
        # stop_mode=clone：克隆最后一帧，而不是变黑
        cmd += ["-vf", f"tpad=stop_mode=clone:stop_duration={pad:.3f}"]
    elif cur > target_sec + 0.02:
        cmd += ["-t", f"{target_sec:.3f}"]

    # Manim 自带音频但这里 muted 播放，统一丢掉
    cmd += ["-an", "-r", "60", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-crf", "18", str(dst)]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-8:]
        raise RuntimeError("ffmpeg 对齐失败:\n" + "\n".join(tail))

    return {
        "path": f"manim/{dst.name}",
        "durationSec": round(probe_duration(dst), 3),
        "rawDurationSec": round(cur, 3),
        "adjust": "padded" if cur < target_sec - 0.02
                  else "trimmed" if cur > target_sec + 0.02 else "exact",
    }


def main():
    ap = argparse.ArgumentParser(description="Manim 片段渲染")
    ap.add_argument("timeline", help="edge_timeline.py 产出的时间轴 JSON")
    ap.add_argument("--out-dir", default="video/public/manim")
    ap.add_argument("--quality", default="h", choices=list(QUALITY))
    ap.add_argument("--work-dir", default="tmp/manim-work",
                    help="保留生成的 scene.py 便于排查")
    ap.add_argument("--background", default="#0f1117",
                    help="Manim 背景色，需与课程底色一致才能无缝衔接")
    ap.add_argument("--transparent", action="store_true",
                    help="保留 alpha 通道（会改用 ProRes .mov，处理更慢）")
    args = ap.parse_args()

    tl_path = ROOT / args.timeline if not Path(args.timeline).is_absolute() else Path(args.timeline)
    timeline = json.loads(tl_path.read_text())

    manim_bin = find_manim()
    out_dir = ROOT / args.out_dir
    work_dir = ROOT / args.work_dir

    # ---- 收集所有 manim 视觉层 ----
    jobs = []
    for si, section in enumerate(timeline.get("sections", [])):
        for bi, beat in enumerate(section.get("beats", [])):
            for ei, ev in enumerate(beat.get("events", [])):
                if ev.get("type") != "manim":
                    continue
                if not ev.get("sceneCode"):
                    raise SystemExit(
                        f"❌ section {si}/beat {bi} 的 manim 事件缺 sceneCode"
                    )
                jobs.append((si, bi, ei, ev, beat))

    if not jobs:
        print("ℹ️  时间轴里没有 manim 视觉层，跳过")
        return

    print(f"🎬 待渲染 Manim 片段: {len(jobs)} 个"
          f"（{QUALITY[args.quality][1]}，"
          f"背景 {args.background}"
          f"{'，保留 alpha' if args.transparent else ''}）")

    failures = []
    work_dir.mkdir(parents=True, exist_ok=True)

    for si, bi, ei, ev, beat in jobs:
        beat_id = ev.get("id") or f"s{si}b{bi}e{ei}"
        class_name = ev.get("className") or "Scene"
        print(f"\n▶ {beat_id}  ({class_name})")

        # 保留一份 scene.py，方便出问题时直接手跑调试
        (work_dir / f"{beat_id}.py").write_text(ev["sceneCode"], encoding="utf-8")

        try:
            res = render_one(
                manim_bin,
                ev["sceneCode"],
                class_name,
                {
                    "durationSec": beat["durationSec"],
                    "words": beat.get("words", []),
                    "narration": beat.get("narration", ""),
                },
                beat_id,
                out_dir,
                args.quality,
                transparent=args.transparent,
                target_sec=beat["durationSec"],
                background=args.background,
            )
        except Exception as exc:  # noqa: BLE001
            failures.append((beat_id, str(exc)))
            print(f"   ✗ {exc}")
            continue

        # manim 片段内部已用 narrator.wait_for 对齐节奏，
        # 所以它占满整个 beat，`at` 锚点对它无意义 —— 强制归零。
        ev["startSec"] = 0.0
        ev["endSec"] = round(beat["durationSec"], 3)
        ev["clipPath"] = res["path"]
        ev["clipDurationSec"] = res["durationSec"]
        ev["clipIsTransparent"] = args.transparent
        ev["clipBackground"] = args.background
        ev["clipRawDurationSec"] = res["rawDurationSec"]

        adj = {"padded": "定格末帧补齐", "trimmed": "裁剪", "exact": "长度天然吻合"}[res["adjust"]]
        print(f"   ✓ {res['path']}  原始 {res['rawDurationSec']:.2f}s"
              f" → 对齐后 {res['durationSec']:.2f}s"
              f" (旁白 {beat['durationSec']:.2f}s, {adj})")

    # ---- 写回时间轴 ----
    tl_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2))
    print(f"\n✅ 时间轴已更新: {tl_path}")

    if failures:
        print(f"\n❌ {len(failures)} 个片段渲染失败:")
        for bid, err in failures:
            print(f"   {bid}: {err.splitlines()[0]}")
        sys.exit(1)


if __name__ == "__main__":
    main()