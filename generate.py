"""Daily Ten: pick today's ten books (one per genre) and write a 10-page summary of each with Gemini.

Each day's set is saved to app/days/<date>.json and committed, so a day is only paid for once.
Re-running fills in any book that failed earlier. Stdlib only.
"""
import datetime as dt
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
DAYS = ROOT / "app" / "days"
TZ = ZoneInfo("Australia/Melbourne")
EPOCH = dt.date(2026, 11, 1)  # day 0 of the rotation
GENRES = ["self_help", "philosophy", "current_affairs", "finance", "growth",
          "history", "science", "psychology", "biography", "business"]

PROMPT = """You are writing for a curious, busy reader who wants the real substance of a great book in about 15 minutes.

Book: "{title}" by {author} ({year}). Genre: {genre}.

Write a summary in exactly 10 pages. Rules:
- Engaging and easy: plain words, short paragraphs, vivid concrete examples, stories and studies the book actually uses. Write like the best magazine feature writer, not a textbook. No filler like "In this chapter the author...".
- Page 1 sets the scene: who the author is, why they wrote it, the question the book answers. Pages 2-9 each carry one core idea, in the order the book builds its argument. Page 10 ties it together and says what the book changed or why it lasts.
- Each page: a short, intriguing title (not "Chapter 3"), 3-5 paragraphs, about 300-380 words in total, and a one-sentence takeaway.
- Accuracy matters more than colour. Only use examples, stories, names and numbers you are confident are in the book. If unsure of a detail, explain the idea without inventing specifics.
- Write entirely in your own words. Do not reproduce passages from the book; at most one short quotation (under 15 words) in the whole summary.
- You may use **bold** for a key phrase, at most twice per page.
- Be honest in the verdict: name a real limitation or criticism of the book.

Return JSON only:
{{"hook": "one or two sentences that make the reader want to start, without hype",
 "one_line": "the book's big idea in one sentence",
 "for_you_if": "one sentence on who will get the most from it",
 "pages": [{{"title": "...", "paragraphs": ["...", "..."], "takeaway": "..."}}],
 "key_ideas": ["five short bullet ideas"],
 "try_this": ["three concrete things to do or think about this week"],
 "verdict": "two sentences: why it is worth reading, and its main limitation"}}"""


def load_books():
    books = {g: [] for g in GENRES}
    for line in (ROOT / "books.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            genre, title, author, year = [p.strip() for p in line.split("|")]
            books[genre].append({"genre": genre, "title": title, "author": author, "year": year})
    return books


def pick(day_no, books):
    """One book per genre. Each genre walks its own shuffled list; every full lap reshuffles."""
    out = []
    for g in GENRES:
        items = books[g]
        lap, pos = divmod(day_no, len(items))
        order = items[:]
        random.Random(f"{g}-{lap}").shuffle(order)
        out.append(order[pos])
    random.Random(day_no).shuffle(out)  # genre order changes daily
    return out


def gemini(book, key, models):
    """Try each model in turn; the free tier often answers 503 'high demand' for a while."""
    last = None
    for model in models:
        for wait in (0, 15, 45):
            time.sleep(wait)
            try:
                return check(gemini_call(book, key, model))
            except urllib.error.HTTPError as ex:
                last = ex
                if ex.code not in (429, 500, 503):
                    break
            except (TimeoutError, urllib.error.URLError, ValueError, KeyError) as ex:
                last = ex
    raise last


def gemini_call(book, key, model):
    body = json.dumps({
        "contents": [{"parts": [{"text": PROMPT.format(**book)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.7, "maxOutputTokens": 32000},
    }).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


def check(s):
    """Reject truncated or malformed answers so the next model gets a try."""
    if len(s.get("pages", [])) != 10 or not all(p.get("paragraphs") and p.get("title") for p in s["pages"]):
        raise ValueError(f"expected 10 full pages, got {len(s.get('pages', []))}")
    words = sum(len(" ".join(p["paragraphs"]).split()) for p in s["pages"])
    if words < 1800:
        raise ValueError(f"summary too short ({words} words)")
    s["words"] = words
    s["minutes"] = round(words / 230)
    return s


def cover(book):
    """Cover image from Open Library, best effort."""
    q = urllib.parse.urlencode({"title": book["title"], "author": book["author"].split(" and ")[0].split(" with ")[0],
                                "limit": 3, "fields": "key,cover_i"})
    try:
        with urllib.request.urlopen(f"https://openlibrary.org/search.json?{q}", timeout=20) as r:
            docs = json.loads(r.read()).get("docs", [])
    except Exception:
        return {}
    for d in docs:
        if d.get("cover_i"):
            return {"cover": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-M.jpg",
                    "link": f"https://openlibrary.org{d['key']}"}
    return {"link": f"https://openlibrary.org{docs[0]['key']}"} if docs else {}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def main():
    key = os.environ.get("GEMINI_API_KEY")
    models = os.environ.get("GEMINI_MODELS", "gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest").split(",")
    today = dt.datetime.now(TZ).date()
    date = today.isoformat()
    path = DAYS / f"{date}.json"
    day = json.loads(path.read_text()) if path.exists() else {"date": date, "books": []}
    done = {b["id"]: b for b in day["books"] if b.get("pages")}

    picks = pick((today - EPOCH).days, load_books())
    books, failed = [], []
    for b in picks:
        bid = slug(f"{b['title']}-{b['author']}")
        if bid in done:
            books.append(done[bid])
            continue
        if not key:
            print("GEMINI_API_KEY not set", file=sys.stderr)
            sys.exit(1)
        try:
            summary = gemini(b, key, models)
        except Exception as ex:
            print(f"failed: {b['title']}: {ex}", file=sys.stderr)
            failed.append(b["title"])
            continue
        books.append({"id": bid, **b, **cover(b), **summary})
        print(f"ok: {b['title']} ({summary['words']} words)")
        time.sleep(7)

    DAYS.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"date": date, "books": books}, ensure_ascii=False, indent=1))
    index = {}
    for f in sorted(DAYS.glob("20*.json"), reverse=True):
        d = json.loads(f.read_text())
        index[d["date"]] = [{"id": b["id"], "title": b["title"], "author": b["author"], "genre": b["genre"]} for b in d["books"]]
    (DAYS / "index.json").write_text(json.dumps({"days": index}, ensure_ascii=False))
    print(f"{date}: {len(books)} books, {len(failed)} failed")


if __name__ == "__main__":
    main()
