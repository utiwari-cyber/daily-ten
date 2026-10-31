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
    <div class="masthead"><div class="brand">Daily <span>Ten</span></div><a class="archive-btn" href="#/archive">Earlier days</a></div>
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
    <div class="masthead"><div class="brand">Daily <span>Ten</span></div><a class="archive-btn" href="#/">Today</a></div>
    <div class="dateline">Every day's ten, newest first</div>
    ${Object.entries(days).map(([date, books]) => `
      <h3>${prettyDate(date)}</h3>
      ${books.map((b) => `<a href="#/read/${date}/${b.id}">${esc(b.title)}<small>${esc(b.author)}${isDone(b.id) ? " · read" : ""}</small></a>`).join("")}
    `).join("")}
  </div>`;
  window.scrollTo(0, 0);
}

async function renderReader(date, id) {
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
    <div class="rbar"><a class="back" href="#/day/${date}" aria-label="Back">‹</a><div class="rtitle">${esc(b.title)}</div><div class="pno" id="pno"></div></div>
    <div class="dots">${Array.from({ length: SLIDES }, () => "<i></i>").join("")}</div>
    <div class="pages" id="pages">${titlePage}${pages}${endPage}</div>
  </div>`;

  const scroller = document.getElementById("pages");
  const dots = [...view.querySelectorAll(".dots i")];
  const pno = document.getElementById("pno");
  const show = (k) => {
    dots.forEach((d, j) => d.classList.toggle("on", j <= k));
    pno.textContent = k === 0 ? "" : k === SLIDES - 1 ? "Done" : `${k} / 10`;
    markSeen(b.id, k);
  };
  let current = Math.min(seen(b.id), SLIDES - 1);
  if (current === SLIDES - 1) current = 0; // finished books reopen at the start
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

let reader = null;
document.addEventListener("keydown", (e) => {
  if (!reader) return;
  if (e.key === "ArrowRight") reader.go(1);
  if (e.key === "ArrowLeft") reader.go(-1);
  if (e.key === "Escape") history.back();
});

async function route() {
  if (view.querySelector(".home:not(.archive)")) sessionStorage.setItem("homeScroll", window.scrollY);
  reader = null;
  const [, kind, a, b] = (location.hash || "#/").split("/");
  try {
    if (kind === "read") await renderReader(a, b);
    else if (kind === "archive") await renderArchive();
    else await renderDay(kind === "day" ? a : undefined);
  } catch {
    view.innerHTML = `<div class="home"><div class="empty"><h2>Couldn't load your books</h2>Check your connection and reopen the app.</div></div>`;
  }
}
window.addEventListener("hashchange", route);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
route();
