"""Record each book as an MP3 with Piper, keeping the last two weeks of audio in app/audio/<date>/.

Each day folder has index.json mapping book id -> {file, seconds, marks}, where marks[k] is the
second at which slide k (title page, ten pages, wrap-up) starts, so the app can follow along.
Books are recorded newest day first until the deadline (NARRATE_DEADLINE, unix seconds); a book still
recording then is stopped and later runs pick up the rest. Each book is recorded in its own process.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAYS = ROOT / "app" / "days"
AUDIO = ROOT / "app" / "audio"
VOICE = "en_US-lessac-high"
KEEP_DAYS = 14
DEADLINE = float(os.environ.get("NARRATE_DEADLINE") or time.time() + 30 * 60)
BOOK_MINUTES = 12  # a book takes roughly this long with all cores busy; don't start one with less time left
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
    keep = {str(date.fromisoformat(max(p.stem for p in DAYS.glob("20*.json"))) - timedelta(days=n)) for n in range(KEEP_DAYS)}
    AUDIO.mkdir(parents=True, exist_ok=True)
    for old in AUDIO.iterdir():
        if old.name not in keep:
            shutil.rmtree(old, ignore_errors=True)
            print(f"dropped {old.name}")
    for leftover in AUDIO.glob("*/*.wav"):
        leftover.unlink()

    todo = []
    for day in sorted(keep, reverse=True):
        src = DAYS / f"{day}.json"
        if not src.exists():
            continue
        index = AUDIO / day / "index.json"
        done = json.loads(index.read_text()) if index.exists() else {}
        todo += [(day, b["id"]) for b in json.loads(src.read_text())["books"] if b["id"] not in done]
    if not todo:
        return print("audio up to date")
    print(f"{len(todo)} books to record, {int(DEADLINE - time.time()) // 60} min available")

    subprocess.run([sys.executable, "-m", "piper.download_voices", "--data-dir", "voices", VOICE], check=True)
    queue, start = iter(todo), time.time()

    def work():
        for day, bid in queue:
            left = DEADLINE - time.time()
            if left < BOOK_MINUTES * 60:
                return
            try:
                out = subprocess.run([sys.executable, __file__, day, bid], capture_output=True, text=True, timeout=left, check=True)
            except subprocess.TimeoutExpired:
                return print(f"stopped {day} {bid} at the deadline")
            except subprocess.CalledProcessError as ex:
                print(f"skipped {day} {bid}: {ex.stderr.strip().splitlines()[-1:]}")
                continue
            index = AUDIO / day / "index.json"
            done = json.loads(index.read_text()) if index.exists() else {}
            done[bid] = json.loads(out.stdout.strip().splitlines()[-1])
            index.write_text(json.dumps(done))
            print(f"recorded {day} {bid} ({done[bid]['seconds'] // 60} min) at {int(time.time() - start)}s")

    workers = os.cpu_count() or 2
    with ThreadPoolExecutor(workers) as pool:
        for _ in range(workers):
            pool.submit(work)


def one(day, bid):
    """Record a single book (run as a child process so a stuck book can be stopped)."""
    book = next(b for b in json.loads((DAYS / f"{day}.json").read_text())["books"] if b["id"] == bid)
    (AUDIO / day).mkdir(parents=True, exist_ok=True)
    print(json.dumps(record(book, AUDIO / day / f"{bid}.mp3")))


if __name__ == "__main__":
    one(*sys.argv[1:]) if len(sys.argv) == 3 else main()
