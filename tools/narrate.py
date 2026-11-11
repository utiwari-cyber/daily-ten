"""Record each book as an MP3 with Piper, keeping the last two weeks of audio in app/audio/<date>/.

Each day folder has index.json mapping book id -> {file, seconds, marks}, where marks[k] is the
second at which slide k (title page, ten pages, wrap-up) starts, so the app can follow along.
Books are recorded newest day first until the time budget runs out; later runs pick up the rest.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import wave
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAYS = ROOT / "app" / "days"
AUDIO = ROOT / "app" / "audio"
VOICE = "en_US-lessac-high"
KEEP_DAYS = 14
BUDGET = float(os.environ.get("NARRATE_MINUTES", "30")) * 60
PAUSE = 0.6  # seconds between paragraphs


def slides(b):
    """The app's reading order, grouped by slide: title page, ten pages, wrap-up. Older books can lack a field."""
    clean = lambda s: s.replace("**", "")
    out = [[f"{b['title']}, by {b['author']}."] + ([clean(b["hook"])] if b.get("hook") else [])]
    for n, p in enumerate(b["pages"], 1):
        out.append([f"Page {n}. {clean(p.get('title', ''))}."] + [clean(t) for t in p.get("paragraphs", [])]
                   + ([f"Takeaway. {clean(p['takeaway'])}"] if p.get("takeaway") else []))
    wrap = []
    if b.get("key_ideas"):
        wrap += ["Key ideas."] + [clean(k) for k in b["key_ideas"]]
    if b.get("try_this"):
        wrap += ["Try this week."] + [clean(k) for k in b["try_this"]]
    if b.get("verdict"):
        wrap.append(f"Verdict. {clean(b['verdict'])}")
    out.append(wrap or ["The end."])
    return out


_voice = None


def record(book, mp3):
    global _voice
    if _voice is None:
        from piper import PiperVoice
        _voice = PiperVoice.load(f"voices/{VOICE}.onnx")
    wav = mp3.with_suffix(".wav")
    marks, frames = [], 0
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(_voice.config.sample_rate)
        for parts in slides(book):
            marks.append(round(frames / w.getframerate(), 2))
            for text in parts:
                for chunk in _voice.synthesize(text):
                    w.writeframes(chunk.audio_int16_bytes)
                    frames += len(chunk.audio_int16_bytes) // 2
                gap = int(w.getframerate() * PAUSE)
                w.writeframes(b"\0\0" * gap)
                frames += gap
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", "32k", str(mp3)], check=True)
    wav.unlink()
    return {"file": mp3.name, "seconds": round(frames / _voice.config.sample_rate), "marks": marks}


def main():
    start = time.time()
    keep = {str(date.fromisoformat(max(p.stem for p in DAYS.glob("20*.json"))) - timedelta(days=n)) for n in range(KEEP_DAYS)}
    AUDIO.mkdir(parents=True, exist_ok=True)
    for old in AUDIO.iterdir():
        if old.name not in keep:
            shutil.rmtree(old, ignore_errors=True)
            print(f"dropped {old.name}")

    todo = []
    for day in sorted(keep, reverse=True):
        src = DAYS / f"{day}.json"
        if not src.exists():
            continue
        index = AUDIO / day / "index.json"
        done = json.loads(index.read_text()) if index.exists() else {}
        todo += [(day, b) for b in json.loads(src.read_text())["books"] if b["id"] not in done]
    if not todo:
        return print("audio up to date")

    subprocess.run([sys.executable, "-m", "piper.download_voices", "--data-dir", "voices", VOICE], check=True)
    workers = os.cpu_count() or 2
    with ProcessPoolExecutor(workers) as pool:
        pending = {}
        queue = iter(todo)

        def submit():
            for day, b in queue:
                if time.time() - start > BUDGET:
                    return
                (AUDIO / day).mkdir(exist_ok=True)
                pending[pool.submit(record, b, AUDIO / day / f"{b['id']}.mp3")] = (day, b["id"])
                return

        for _ in range(workers):
            submit()
        while pending:
            fut = next(as_completed(pending))
            day, bid = pending.pop(fut)
            if fut.exception():
                print(f"skipped {day} {bid}: {fut.exception()!r}")
                submit()
                continue
            index = AUDIO / day / "index.json"
            done = json.loads(index.read_text()) if index.exists() else {}
            done[bid] = fut.result()
            index.write_text(json.dumps(done))
            print(f"recorded {day} {bid} ({done[bid]['seconds'] // 60} min) at {int(time.time() - start)}s")
            submit()


if __name__ == "__main__":
    main()
