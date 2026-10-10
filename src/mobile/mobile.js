import {
  cabinet,
  dish,
  padlock,
  query,
  router,
  settle,
  turntable,
  vault,
} from "@lucasmarkes/hairline";

// Visiting /m/ directly clears a remembered "desktop" choice so the
// phone redirect on / works again next time.
try {
  localStorage.removeItem("viewMode");
  document.cookie = "viewMode=; path=/; max-age=0; SameSite=Lax";
} catch {}

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SAVE_DATA = !!(navigator.connection && navigator.connection.saveData);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ==========================================
// Starfield — lightweight 2D canvas stand-in for the desktop WebGL
// tunnel. Stars fly toward the viewer; scroll velocity drives travel
// speed (both directions) and warps streak them into hyperspace lines.
// ==========================================
const canvas = $("#m-stars");
const ctx = canvas.getContext("2d");
const PALETTE = ["#ffffff", "#e6f1ff", "#a2c8ff", "#7ee7ff", "#ffecc9", "#ffcca3", "#e7b8ff"];
const CRUISE = 0.035;
let W = 0, H = 0, DPR = 1;
let stars = [];
let warpBoost = 0;
let scrollSpeed = 0;
let lastScrollY = window.scrollY;

function spawnStar(s, z) {
  s.x = (Math.random() * 2 - 1) * W * 0.6;
  s.y = (Math.random() * 2 - 1) * H * 0.6;
  s.z = z;
  s.px = null;
  s.py = null;
  return s;
}

function buildStars() {
  const n = Math.round(Math.min(720, Math.max(260, (W * H) / 560)));
  stars = Array.from({ length: n }, () => {
    const s = spawnStar({}, 0.05 + Math.random() * 0.95);
    const r = Math.random();
    s.r = r > 0.985 ? 2.4 : r > 0.88 ? 1.5 : 0.7 + Math.random() * 0.6;
    s.c = PALETTE[(Math.random() * PALETTE.length) | 0];
    s.tw = 1.5 + Math.random() * 4;
    s.to = Math.random() * Math.PI * 2;
    return s;
  });
}

function resizeStars() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildStars();
  if (REDUCE) drawStars(0, 0);
}

function drawStars(dt, t) {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.46;
  const speed = CRUISE + scrollSpeed + warpBoost * 2.4;
  const streak = Math.abs(speed) > 0.22;
  for (const s of stars) {
    s.z -= speed * dt;
    if (s.z < 0.03) spawnStar(s, 1);
    else if (s.z > 1) spawnStar(s, 0.05 + Math.random() * 0.2);
    const sx = cx + s.x / s.z;
    const sy = cy + s.y / s.z;
    if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) {
      spawnStar(s, speed >= 0 ? 1 : 0.05 + Math.random() * 0.2);
      continue;
    }
    const depth = 1 - s.z;
    const tw = 0.82 + 0.18 * Math.sin(t * s.tw + s.to);
    const a = Math.min(1, depth * depth * 1.6 * tw + warpBoost * 0.4);
    const size = s.r * (0.35 + depth * 1.5);
    ctx.globalAlpha = a;
    if (streak && s.px !== null) {
      ctx.strokeStyle = s.c;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    } else if (size > 1.6) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = s.c;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
    s.px = sx;
    s.py = sy;
  }
  ctx.globalAlpha = 1;
}

// ==========================================
// Scroll-linked HUD bits (progress bar + crawl tilt), batched into the
// same rAF as the stars.
// ==========================================
const hudProgress = $("#m-hud-progress");
const crawl = $(".m-crawl");
let crawlNear = false;
let lastCp = -1;

function updateScrollUI() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? window.scrollY / max : 0;
  if (hudProgress) hudProgress.style.transform = `scaleX(${p.toFixed(4)})`;
  if (crawl && crawlNear && !REDUCE) {
    const r = crawl.getBoundingClientRect();
    const cp = Math.min(1, Math.max(0, (window.innerHeight - r.top) / (window.innerHeight + r.height)));
    if (Math.abs(cp - lastCp) > 0.002) {
      crawl.style.setProperty("--cp", cp.toFixed(3));
      lastCp = cp;
    }
  }
}

let lastT = performance.now();
let rafId = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  const y = window.scrollY;
  const v = dt > 0 ? (y - lastScrollY) / dt : 0;
  lastScrollY = y;
  const target = Math.max(-0.9, Math.min(1.4, v * 0.0009));
  scrollSpeed += (target - scrollSpeed) * Math.min(1, dt * 6);
  warpBoost *= Math.pow(0.12, dt);
  if (warpBoost < 0.002) warpBoost = 0;

  drawStars(dt, now / 1000);
  updateScrollUI();
}

function startLoop() {
  if (rafId || REDUCE) return;
  lastT = performance.now();
  lastScrollY = window.scrollY;
  rafId = requestAnimationFrame(frame);
}
function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

resizeStars();
window.addEventListener("resize", resizeStars);
if (REDUCE) {
  window.addEventListener("scroll", updateScrollUI, { passive: true });
  updateScrollUI();
} else {
  startLoop();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopLoop();
    pauseAllVideos();
  } else {
    startLoop();
  }
});

// ==========================================
// Scramble decode — same 21st.dev scramble-text effect as the desktop
// window menu, with a per-element run token so panels can decode in
// parallel without cancelling each other.
// ==========================================
const SCRAMBLE = "-_~`!@#$%^&*()+=[]{}|;:,.<>?/\\";

function scrambleEl(el, delayMs) {
  const text = el.dataset.text ?? (el.dataset.text = el.textContent);
  if (REDUCE) {
    el.textContent = text;
    return;
  }
  const chars = [...text];
  const run = (el._run = (el._run || 0) + 1);
  const perTick = Math.max(1, Math.ceil(chars.length / 30));
  const t0 = performance.now() + delayMs;
  let revealed = 0;
  const tick = (now) => {
    if (run !== el._run) return;
    if (now < t0) {
      requestAnimationFrame(tick);
      return;
    }
    revealed = Math.min(chars.length, revealed + perTick);
    let out = "";
    for (let i = 0; i < chars.length; i++) {
      out +=
        i < revealed || chars[i] === " "
          ? chars[i]
          : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
    }
    el.textContent = out;
    if (revealed < chars.length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function decodeGroup(root) {
  $$("[data-scramble]", root).forEach((el, i) => scrambleEl(el, 60 + i * 85));
}

// ==========================================
// Windshield hologram — perspective floor grid + one hairline figure at
// a time, glitch-swapped. Torn down while the hero is off-screen.
// ==========================================
const gridEl = $(".m-holo-grid");
if (gridEl) {
  const NS = "http://www.w3.org/2000/svg";
  const mk = (x1, y1, x2, y2) => {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", x1);
    l.setAttribute("y1", y1);
    l.setAttribute("x2", x2);
    l.setAttribute("y2", y2);
    return l;
  };
  const rays = $(".m-grid-rays", gridEl);
  for (let i = 0; i <= 72; i++) rays.appendChild(mk(400, -140, -1456 + i * 51.6, 520));
  const rows = $(".m-grid-rows", gridEl);
  for (let y = 500; y > 15; y = Math.round(y * 0.92)) {
    const l = mk(-20, y, 820, y);
    l.setAttribute("stroke-opacity", (Math.pow(y / 500, 1.7) * 0.6).toFixed(3));
    rows.appendChild(l);
  }
}

const FIGURES = [dish, router, padlock, settle, query, vault, cabinet, turntable];
const figEl = $("#m-figure");
let fig = null;
let figHost = null;
let figIdx = 0;
let figTimer = 0;
let figActive = false;

function mountFigure(i) {
  if (!figEl) return;
  const host = document.createElement("div");
  host.className = "m-figure-host on";
  figEl.appendChild(host);
  const next = FIGURES[i](host, { intensity: 0.7, play: !REDUCE });
  if (fig) fig.destroy();
  if (figHost) figHost.remove();
  fig = next;
  figHost = host;
  figIdx = i;
}
function swapFigure() {
  if (!figActive) return;
  figEl.classList.add("glitching");
  setTimeout(() => {
    if (!figActive) return;
    let n = figIdx;
    while (n === figIdx) n = (Math.random() * FIGURES.length) | 0;
    mountFigure(n);
  }, 160);
  setTimeout(() => figEl.classList.remove("glitching"), 360);
  figTimer = setTimeout(swapFigure, 2600 + Math.random() * 2000);
}
function startFigures() {
  if (figActive || !figEl) return;
  figActive = true;
  if (!fig) mountFigure(figIdx);
  if (!REDUCE) figTimer = setTimeout(swapFigure, 2200);
}
function stopFigures() {
  figActive = false;
  clearTimeout(figTimer);
  if (fig) fig.destroy();
  if (figHost) figHost.remove();
  fig = null;
  figHost = null;
}

// ==========================================
// Boot intro — once per session, skipped for deep links.
// ==========================================
const boot = $("#m-boot");
const bootTyped = boot && $(".m-boot-typed", boot);
const BOOT_LINE = "A long time ago in a galaxy far, far away....";
const hero = $(".m-hero");

function onBooted() {
  document.body.classList.remove("booting");
  if (hero) decodeGroup(hero);
  if (!REDUCE) warpBoost = 0.9;
}

function runBoot() {
  let seen = false;
  try {
    seen = sessionStorage.getItem("mBoot") === "1";
    sessionStorage.setItem("mBoot", "1");
  } catch {}
  if (!boot || !bootTyped || seen || location.hash) {
    if (boot) boot.remove();
    onBooted();
    return;
  }
  let done = false;
  let timer = 0;
  const wait = (ms, fn) => {
    timer = setTimeout(() => !done && fn(), ms);
  };
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    boot.classList.add("done");
    onBooted();
    setTimeout(() => boot.remove(), 950);
  };
  const type = (i) => {
    if (i > BOOT_LINE.length) {
      wait(900, finish);
      return;
    }
    bootTyped.textContent = BOOT_LINE.slice(0, i);
    const ch = BOOT_LINE[i - 1];
    let d = 32 + Math.random() * 30;
    if (ch === ",") d = 280;
    else if (ch === ".") d = 160;
    wait(d, () => type(i + 1));
  };
  boot.addEventListener("pointerdown", finish, { once: true });
  window.addEventListener("keydown", finish, { once: true });
  if (REDUCE) {
    bootTyped.textContent = BOOT_LINE;
    wait(900, finish);
  } else {
    wait(450, () => type(1));
  }
}

// ==========================================
// Reveal-on-scroll + decode for hologram panels
// ==========================================
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      if (e.target.hasAttribute("data-decode")) decodeGroup(e.target);
      revealIO.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
);
$$("[data-reveal]").forEach((el) => revealIO.observe(el));

if (crawl) {
  new IntersectionObserver(
    ([e]) => {
      crawlNear = e.isIntersecting;
    },
    { rootMargin: "20% 0px 20% 0px" }
  ).observe(crawl);
}

// ==========================================
// Section tracking — HUD readout, dock highlight, dock visibility,
// hologram lifecycle.
// ==========================================
const hudSec = $("#m-hud-sec");
const dock = $(".m-dock");
const dockLinks = $$(".m-dock a");

const secIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.id;
      if (hudSec) hudSec.textContent = `// ${e.target.dataset.sec}`;
      dockLinks.forEach((a) => a.classList.toggle("is-on", a.dataset.dock === id));
    }
  },
  { rootMargin: "-45% 0px -50% 0px" }
);
$$("[data-sec]").forEach((s) => secIO.observe(s));

if (hero) {
  new IntersectionObserver(
    ([e]) => {
      const heroOn = e.intersectionRatio > 0.3;
      if (dock) dock.classList.toggle("show", !heroOn);
      if (e.isIntersecting) startFigures();
      else stopFigures();
    },
    { threshold: [0, 0.3] }
  ).observe(hero);
}

// ==========================================
// Navigation — terminal buttons warp (flash swallows the cut, like the
// desktop hyperspace jump); the dock glides.
// ==========================================
const flash = $("#m-flash");

function jumpTo(target, warp) {
  if (!target) return;
  if (REDUCE || !warp) {
    warpBoost = Math.max(warpBoost, 0.35);
    target.scrollIntoView({ behavior: REDUCE ? "auto" : "smooth", block: "start" });
    return;
  }
  warpBoost = 1.4;
  flash.classList.add("on");
  setTimeout(() => {
    target.scrollIntoView({ behavior: "instant", block: "start" });
    flash.classList.remove("on");
  }, 190);
}

$$("a[href^='#']").forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    jumpTo(target, a.hasAttribute("data-warp"));
  });
});

// ==========================================
// Showcase videos — phone-sized encodes, nothing downloads until a card
// is on screen. Autoplay muted while >=55% visible (unless Data Saver /
// reduced motion), one feed at a time, tap to pause/resume.
// ==========================================
const mediaCtl = [];
let playingCtl = null;

function pauseAllVideos() {
  mediaCtl.forEach((c) => c.pause());
}

$$("[data-media]").forEach((media) => {
  const screen = $(".m-screen", media);
  const vids = $$("video", screen);
  const tabs = $$(".m-tab", media);
  const playBtn = $(".m-play", screen);
  let active = Math.max(0, vids.findIndex((v) => v.classList.contains("is-on")));
  let inView = false;
  let userPaused = false;
  let userStarted = false;
  const autoplay = !SAVE_DATA && !REDUCE;

  const ctl = {
    play() {
      const v = vids[active];
      if (!v.src && v.dataset.src) v.src = v.dataset.src;
      if (playingCtl && playingCtl !== ctl) playingCtl.pause();
      playingCtl = ctl;
      const p = v.play();
      if (p && p.catch) p.catch(() => screen.classList.remove("is-playing"));
    },
    pause() {
      vids.forEach((v) => !v.paused && v.pause());
      screen.classList.remove("is-playing");
      if (playingCtl === ctl) playingCtl = null;
    },
  };
  mediaCtl.push(ctl);

  vids.forEach((v) => {
    v.addEventListener("playing", () => v === vids[active] && screen.classList.add("is-playing"));
    v.addEventListener("pause", () => v === vids[active] && screen.classList.remove("is-playing"));
  });

  const wants = () => inView && !userPaused && (autoplay || userStarted);

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userStarted = true;
    userPaused = false;
    ctl.play();
  });
  screen.addEventListener("click", () => {
    if (!screen.classList.contains("is-playing")) return;
    userPaused = true;
    ctl.pause();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const i = Number(tab.dataset.tab);
      if (i === active) return;
      ctl.pause();
      vids[active].classList.remove("is-on");
      active = i;
      vids[active].classList.add("is-on");
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      if (wants()) ctl.play();
    });
  });

  new IntersectionObserver(
    ([e]) => {
      inView = e.intersectionRatio >= 0.55;
      if (wants()) ctl.play();
      else if (e.intersectionRatio < 0.25) ctl.pause();
    },
    { threshold: [0, 0.25, 0.55] }
  ).observe(screen);
});

runBoot();
