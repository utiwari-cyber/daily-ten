"""One-off listening test: narrate one book with Piper in a few voices for the iPhone test page."""
import json
import subprocess
import sys
import wave
from pathlib import Path

from piper import PiperVoice

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "listen-test"
VOICES = ["en_US-lessac-high", "en_US-ryan-high", "en_GB-cori-high"]


def blocks(b):
    """Same reading order as the app: title page, ten pages with takeaways, wrap-up."""
    clean = lambda s: s.replace("**", "")
    out = [f"{b['title']}, by {b['author']}.", clean(b["hook"])]
    for n, p in enumerate(b["pages"], 1):
        out.append(f"Page {n}. {clean(p['title'])}.")
        out += [clean(t) for t in p["paragraphs"]]
        out.append(f"Takeaway. {clean(p['takeaway'])}")
    out.append("Key ideas.")
    out += [clean(k) for k in b["key_ideas"]]
    out.append(f"Verdict. {clean(b['verdict'])}")
    return out


def narrate(voice, parts, mp3):
    wav = mp3.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        first = True
        for text in parts:
            for chunk in voice.synthesize(text):
                if first:
                    w.setnchannels(chunk.sample_channels)
                    w.setsampwidth(chunk.sample_width)
                    w.setframerate(chunk.sample_rate)
                    first = False
                w.writeframes(chunk.audio_int16_bytes)
            w.writeframes(b"\0" * int(w.getframerate() * 0.6) * w.getsampwidth())  # pause between paragraphs
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", "48k", str(mp3)], check=True)
    wav.unlink()


def main():
    days = json.loads((ROOT / "app" / "days" / "index.json").read_text())["days"]
    date = max(days)
    book = json.loads((ROOT / "app" / "days" / f"{date}.json").read_text())["books"][0]
    parts = blocks(book)
    sample = parts[:2 + 1 + len(book["pages"][0]["paragraphs"]) + 1]  # title, hook, page 1
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for name in VOICES:
        try:
            subprocess.run([sys.executable, "-m", "piper.download_voices", "--data-dir", "voices", name], check=True)
            voice = PiperVoice.load(f"voices/{name}.onnx")
        except Exception as ex:
            print(f"skip {name}: {ex}")
            continue
        narrate(voice, sample, OUT / f"{name}-sample.mp3")
        narrate(voice, parts, OUT / f"{name}-full.mp3")
        made.append(name)
        print(f"ok {name}")
    (OUT / "meta.json").write_text(json.dumps({"title": book["title"], "author": book["author"], "cover": book.get("cover"), "voices": made}))


if __name__ == "__main__":
    main()
