const GENRES = {
  self_help: "Self-help", philosophy: "Philosophy", current_affairs: "Current affairs", finance: "Finance",
  growth: "Personal growth", history: "History", science: "Science", psychology: "Psychology",
  biography: "Biography & memoir", business: "Business",
};
const TINT = {
  self_help: "#f0d9c4", philosophy: "#d9dfe8", current_affairs: "#e8d6d3", finance: "#d6e4d6", growth: "#efe1bf",
  history: "#e2d7c6", science: "#d3e3e6", psychology: "#e3d8ea", biography: "#ead9de", business: "#dcdcd2",
};
const SLIDES = 12; // title page + 10 pages + wrap-up

const view = document.getElementById("view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

let index = null;
const dayCache = {};
async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
const getIndex = async () => (index ||= (await getJSON("days/index.json")).days);
const getDay = async (date) => (dayCache[date] ||= await getJSON(`days/${date}.json`));

// Reading progress: highest slide reached per book
const seen = (id) => +(localStorage.getItem(`dt:${id}`) || 0);
const markSeen = (id, i) => { if (i > seen(id)) localStorage.setItem(`dt:${id}`, i); };
const isDone = (id) => seen(id) >= SLIDES - 1;

const booksRead = () => Object.keys(localStorage).filter((k) => k.startsWith("dt:") && localStorage[k] === String(SLIDES - 1)).length;

// Reading preferences: text size, typeface, theme
const SIZES = [0.85, 0.92, 1, 1.1, 1.2, 1.32, 1.45];
const FONTS = { serif: "New York", charter: "Charter", palatino: "Palatino", sans: "Sans" };
const prefs = { size: 1, font: "serif", theme: "auto", ...JSON.parse(localStorage.getItem("dt:prefs") || "{}") };
function applyPrefs() {
  const r = document.documentElement;
  r.style.setProperty("--scale", prefs.size);
  r.dataset.font = prefs.font;
  r.dataset.theme = prefs.theme;
  const dark = prefs.theme === "dark" || (prefs.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector("meta[name=theme-color]").content = dark ? "#17150f" : "#f6f1e8";
  localStorage.setItem("dt:prefs", JSON.stringify(prefs));
}
applyPrefs();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyPrefs);

function openSettings() {
  const el = document.createElement("div");
  el.className = "sheet-wrap";
  el.innerHTML = `<div class="sheet" role="dialog" aria-label="Reading settings">
    <div class="row"><span>Text size</span><div class="seg">
      <button data-size="-1" aria-label="Smaller text">A−</button><output></output><button data-size="1" aria-label="Larger text">A+</button></div></div>
    <div class="row col"><span>Typeface</span><div class="seg">
      ${Object.entries(FONTS).map(([k, v]) => `<button data-font="${k}" class="f-${k}">${v}</button>`).join("")}</div></div>
    <p class="preview">The best books change how you see one thing for the rest of your life.</p>
    <div class="row col"><span>Theme</span><div class="seg">
      ${["auto", "light", "dark"].map((t) => `<button data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
    <button class="btn ghost close">Done</button>
  </div>`;
  const sync = () => {
    el.querySelector("output").textContent = `${Math.round(prefs.size * 100)}%`;
    el.querySelectorAll("[data-font]").forEach((b) => b.classList.toggle("on", b.dataset.font === prefs.font));
    el.querySelectorAll("[data-theme]").forEach((b) => b.classList.toggle("on", b.dataset.theme === prefs.theme));
  };
  el.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (e.target === el || t?.classList.contains("close")) return el.remove();
    if (!t) return;
    if (t.dataset.size) {
      const i = SIZES.indexOf(prefs.size) + +t.dataset.size;
      prefs.size = SIZES[Math.max(0, Math.min(SIZES.length - 1, i < 0 ? 2 : i))];
    }
    if (t.dataset.font) prefs.font = t.dataset.font;
    if (t.dataset.theme) prefs.theme = t.dataset.theme;
    applyPrefs();
    sync();
  });
  sync();
  document.body.append(el);
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-settings]")) openSettings(); });

// Bookmarks: one per page, newest first
const getBM = () => JSON.parse(localStorage.getItem("dt:bm") || "[]");
const saveBM = (list) => localStorage.setItem("dt:bm", JSON.stringify(list));
const bmKey = (date, id, slide) => `${date}/${id}/${slide}`;
const hasBM = (key) => getBM().some((m) => m.key === key);

function prettyDate(date, long = true) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short", year: "numeric" });
}

function coverHTML(b, cls = "") {
  return `<div class="cover ${cls}" style="--tint:${TINT[b.genre]}">${esc(b.title)}${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>`;
}

async function renderDay(date) {
  const days = await getIndex();
  const dates = Object.keys(days);
  date ||= dates[0];
  if (!date) {
    view.innerHTML = `<div class="home"><div class="empty"><h2>First books on the way</h2>Today's ten are being written. Check back soon.</div></div>`;
    return;
  }
  const day = await getDay(date);
  const finished = day.books.filter((b) => isDone(b.id)).length;
  const isLatest = date === dates[0];
  view.innerHTML = `<div class="home">
    <div class="masthead"><div class="brand">Daily <span>Ten</span></div><div class="links"><a class="archive-btn" href="#/archive">Earlier</a><a class="archive-btn" href="#/saved">Saved</a><button class="archive-btn" data-settings aria-label="Reading settings">Aa</button></div></div>
    <div class="dateline">${isLatest ? "Today · " : ""}${prettyDate(date)} · ${finished} of ${day.books.length} read</div>
    <div class="progress-line"><i style="width:${(finished / (day.books.length || 1)) * 100}%"></i></div>
    ${day.books.map((b) => {
      const s = seen(b.id);
      const status = isDone(b.id) ? "Finished" : s ? `Page ${Math.min(s, 10)} of 10 · continue` : `${b.minutes} min · 10 pages`;
      return `<a class="book ${isDone(b.id) ? "done" : ""}" href="#/read/${date}/${b.id}">
        ${coverHTML(b)}
        <div class="info">
          <div class="genre">${esc(GENRES[b.genre])}</div>
          <h2>${esc(b.title)}</h2>
          <div class="author">${esc(b.author)} · ${esc(b.year)}</div>
          <div class="hook">${esc(b.hook)}</div>
          <div class="status">${status}</div>
        </div></a>`;
    }).join("")}
    ${day.books.length < 10 ? `<div class="empty">The rest of today's books are still being written.</div>` : ""}
  </div>`;
  window.scrollTo(0, +sessionStorage.getItem("homeScroll") || 0);
}

async function renderArchive() {
  const days = await getIndex();
  view.innerHTML = `<div class="home archive">
    <div class="masthead"><div class="brand">Daily <span>Ten</span></div><div class="links"><a class="archive-btn" href="#/">Today</a><a class="archive-btn" href="#/saved">Saved</a><button class="archive-btn" data-settings aria-label="Reading settings">Aa</button></div></div>
    <div class="dateline">Every day's ten, newest first</div>
    ${Object.entries(days).map(([date, books]) => `
      <h3>${prettyDate(date)}</h3>
      ${books.map((b) => `<a href="#/read/${date}/${b.id}">${esc(b.title)}<small>${esc(b.author)}${isDone(b.id) ? " · read" : ""}</small></a>`).join("")}
    `).join("")}
  </div>`;
  window.scrollTo(0, 0);
}

function renderSaved() {
  const list = getBM();
  view.innerHTML = `<div class="home saved">
    <div class="masthead"><div class="brand">Daily <span>Ten</span></div><div class="links"><a class="archive-btn" href="#/">Today</a><a class="archive-btn" href="#/saved">Saved</a><button class="archive-btn" data-settings aria-label="Reading settings">Aa</button></div></div>
    <div class="dateline">Pages you bookmarked</div>
    ${list.length ? list.map((m) => `<a class="item" href="#/read/${m.key}">
      <div><b>${esc(m.title)}</b><div class="pt">${m.slide == SLIDES - 1 ? "Wrap-up" : m.slide == 0 ? "Title page" : `Page ${m.slide}`} · ${esc(m.page)}</div>
      <small>${esc(m.author)} · ${prettyDate(m.date, false)}</small></div>
      <button class="rm" data-rm="${esc(m.key)}" aria-label="Remove bookmark">×</button></a>`).join("")
    : `<div class="empty">No bookmarks yet.<br>Tap the ribbon at the top of any page to save it here.</div>`}
  </div>`;
  view.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    saveBM(getBM().filter((m) => m.key !== b.dataset.rm));
    renderSaved();
  }));
  window.scrollTo(0, 0);
}

async function renderReader(date, id, at) {
  const day = await getDay(date);
  const i = day.books.findIndex((b) => b.id === id);
  const b = day.books[i];
  if (!b) return (location.hash = "#/");
  const next = day.books.slice(i + 1).concat(day.books.slice(0, i)).find((x) => !isDone(x.id));

  const titlePage = `<section class="page title-page"><div class="in">
    ${coverHTML(b, "big-cover")}
    <div class="genre">${esc(GENRES[b.genre])}</div>
    <h1>${esc(b.title)}</h1>
    <div class="by">${esc(b.author)} · ${esc(b.year)}</div>
    <p class="hook-big">${esc(b.hook)}</p>
    <div class="meta"><span class="chip">${b.minutes} min read</span><span class="chip">10 pages</span></div>
    <p class="for"><b>The big idea:</b> ${esc(b.one_line)}</p>
    <p class="for"><b>For you if</b> ${esc(b.for_you_if.replace(/^for you if /i, ""))}</p>
    <div class="swipe-hint">Swipe to start →</div>
  </div></section>`;

  const pages = b.pages.map((p, n) => `<section class="page"><div class="in">
    <div class="num">Page ${n + 1} of 10</div>
    <h2>${esc(p.title)}</h2>
    ${p.paragraphs.map((t) => `<p>${rich(t)}</p>`).join("")}
    <div class="takeaway"><b>Takeaway</b>${rich(p.takeaway)}</div>
  </div></section>`).join("");

  const endPage = `<section class="page end-page"><div class="in">
    <div class="num">Wrap-up</div>
    <h2>${esc(b.one_line)}</h2>
    <h3>Key ideas</h3><ul>${b.key_ideas.map((k) => `<li>${rich(k)}</li>`).join("")}</ul>
    <h3>Try this week</h3><ul>${b.try_this.map((k) => `<li>${rich(k)}</li>`).join("")}</ul>
    <h3>Verdict</h3><p class="verdict">${rich(b.verdict)}</p>
    <div class="actions">
      ${next ? `<a class="btn primary" href="#/read/${date}/${next.id}">Next: ${esc(next.title)}</a>` : `<a class="btn primary" href="#/day/${date}">All ten done. Back to the list</a>`}
      ${b.link ? `<a class="btn ghost" href="${esc(b.link)}" target="_blank" rel="noopener">Find the book</a>` : ""}
      <a class="btn ghost" href="#/day/${date}">Back to today's list</a>
    </div>
  </div></section>`;

  view.innerHTML = `<div class="reader">
    <div class="rbar"><a class="back" href="#/day/${date}" aria-label="Back">‹</a><div class="rtitle">${esc(b.title)}</div><div class="pno" id="pno"></div>
      <button class="ibtn bm" id="bm" aria-label="Bookmark this page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg></button>
      <button class="ibtn" data-settings aria-label="Reading settings">Aa</button></div>
    <div class="dots">${Array.from({ length: SLIDES }, () => "<i></i>").join("")}</div>
    <div class="pages" id="pages">${titlePage}${pages}${endPage}</div>
  </div>`;

  const scroller = document.getElementById("pages");
  const dots = [...view.querySelectorAll(".dots i")];
  const pno = document.getElementById("pno");
  const bm = document.getElementById("bm");
  const pageName = (k) => (k === 0 ? b.hook : k === SLIDES - 1 ? b.one_line : b.pages[k - 1].title);
  const show = (k) => {
    dots.forEach((d, j) => d.classList.toggle("on", j <= k));
    pno.textContent = k === 0 ? "" : k === SLIDES - 1 ? "Done" : `${k} / 10`;
    bm.classList.toggle("on", hasBM(bmKey(date, id, k)));
    const firstFinish = k === SLIDES - 1 && !isDone(b.id);
    markSeen(b.id, k);
    if (firstFinish) celebrate(day, scroller.children[k]);
  };
  bm.addEventListener("click", () => {
    const key = bmKey(date, id, current);
    const list = getBM().filter((m) => m.key !== key);
    if (list.length === getBM().length) list.unshift({ key, date, slide: current, title: b.title, author: b.author, page: pageName(current) });
    saveBM(list);
    bm.classList.toggle("on", hasBM(key));
  });
  let current = Math.min(seen(b.id), SLIDES - 1);
  if (current === SLIDES - 1) current = 0; // finished books reopen at the start
  if (at !== undefined && at !== "") current = Math.max(0, Math.min(SLIDES - 1, +at || 0));
  requestAnimationFrame(() => { scroller.scrollLeft = current * scroller.clientWidth; show(current); });
  scroller.addEventListener("scroll", () => {
    const k = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (k !== current) {
      current = k;
      show(k);
      scroller.children[k].scrollTop = 0;
    }
  }, { passive: true });
  reader = { scroller, go: (d) => scroller.scrollTo({ left: (current + d) * scroller.clientWidth, behavior: "smooth" }) };
}

// Finishing a book: confetti plus a running tally
function celebrate(day, page) {
  const today = day.books.filter((x) => isDone(x.id)).length;
  const total = booksRead();
  const cheer = document.createElement("div");
  cheer.className = "cheer";
  cheer.innerHTML = `<b>${today === day.books.length ? "All ten done!" : "Book finished!"}</b>
    <span>${today} of ${day.books.length} today · ${total} ${total === 1 ? "book" : "books"} read with Daily Ten</span>`;
  page.querySelector(".in").prepend(cheer);
  page.scrollTop = 0;
  if (navigator.vibrate) navigator.vibrate(30);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(today === day.books.length ? 260 : 140);
}

function confetti(n) {
  const c = document.createElement("canvas");
  c.className = "confetti";
  document.body.append(c);
  const dpr = devicePixelRatio || 1, W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
  const ctx = c.getContext("2d");
  const colors = ["#7a3e2b", "#e0a184", "#d9b44a", "#5b8a72", "#6b7fb3", "#c9705a"];
  const ps = Array.from({ length: n }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.4,
    vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
    s: (5 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (t) => {
    const e = t - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - e / 3000);
    for (const p of ps) {
      p.vy += 0.4 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    e < 3000 ? requestAnimationFrame(tick) : c.remove();
  };
  requestAnimationFrame(tick);
}

// Dictionary: select a single word while reading to see its meaning
const defs = {};
let selTimer;
document.addEventListener("selectionchange", () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const sel = getSelection();
    const w = sel.toString().trim().replace(/[’']s$/, "").replace(/[.,;:!?”"]+$/, "");
    if (reader && /^[A-Za-z][A-Za-z'’-]{1,29}$/.test(w) && sel.anchorNode?.parentElement?.closest(".page")) lookup(w.toLowerCase());
  }, 450);
});

function dictCard(html) {
  let card = document.getElementById("dict");
  if (!card) {
    card = document.createElement("div");
    card.id = "dict";
    card.className = "dict";
    card.addEventListener("click", (e) => { if (e.target.closest(".x")) card.remove(); });
    document.body.append(card);
  }
  card.innerHTML = `<button class="x" aria-label="Close">×</button>${html}`;
}

async function define(w) {
  if (defs[w]) return defs[w];
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
  if (res.status === 404) return (defs[w] = null);
  if (!res.ok) throw new Error(res.status);
  return (defs[w] = (await res.json())[0]);
}

async function lookup(w) {
  dictCard(`<div class="w">${esc(w)}</div><p class="muted">Looking up…</p>`);
  try {
    // Fall back to the singular for simple plurals ("ideas" -> "idea")
    const entry = (await define(w)) || (w.endsWith("s") && (await define(w.slice(0, -1))));
    if (!entry) return dictCard(`<div class="w">${esc(w)}</div><p class="muted">No definition found.</p>`);
    const ph = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || "";
    dictCard(`<div class="w">${esc(entry.word)}<span class="ph">${esc(ph)}</span></div>
      ${entry.meanings.slice(0, 3).map((m) => `<div class="pos">${esc(m.partOfSpeech)}</div>
        <ol>${m.definitions.slice(0, 2).map((d) => `<li>${esc(d.definition)}</li>`).join("")}</ol>`).join("")}`);
  } catch {
    dictCard(`<div class="w">${esc(w)}</div><p class="muted">Couldn't reach the dictionary. Check your connection.</p>`);
  }
}

let reader = null;
document.addEventListener("keydown", (e) => {
  if (!reader) return;
  if (e.key === "ArrowRight") reader.go(1);
  if (e.key === "ArrowLeft") reader.go(-1);
  if (e.key === "Escape") {
    const open = document.querySelector(".sheet-wrap, #dict");
    open ? open.remove() : history.back();
  }
});

async function route() {
  if (view.querySelector(".home:not(.archive)")) sessionStorage.setItem("homeScroll", window.scrollY);
  reader = null;
  document.querySelector(".sheet-wrap, #dict")?.remove();
  const [, kind, a, b, c] = (location.hash || "#/").split("/");
  try {
    if (kind === "read") await renderReader(a, b, c);
    else if (kind === "archive") await renderArchive();
    else if (kind === "saved") renderSaved();
    else await renderDay(kind === "day" ? a : undefined);
  } catch {
    view.innerHTML = `<div class="home"><div class="empty"><h2>Couldn't load your books</h2>Check your connection and reopen the app.</div></div>`;
  }
}
window.addEventListener("hashchange", route);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
route();
