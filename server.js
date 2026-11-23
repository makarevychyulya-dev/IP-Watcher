"use strict";
// Сервер сайту: віддає сторінку з папки public і обробляє запити пошуку.
// Ключ Claude API зберігається лише тут, у змінній середовища ANTHROPIC_API_KEY.

const path = require("path");
const crypto = require("crypto");
const express = require("express");

const settings = require("./config/settings");
const CLASSES = require("./config/classes");
const REGIONS = require("./config/regions");
const { ANGLES, CATEGORIES, ASPECTS } = require("./config/search");
const { analyzeImage, searchDirection, sanitizeVisual, parseAllowed, clip } = require("./lib/watch");
const { ClaudeError } = require("./lib/claude");
const { version } = require("./package.json");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Пароль доступу (якщо задано ACCESS_PASSWORD) ---------- */
function checkPassword(req, res, next) {
  if (!settings.accessPassword) return next();
  let given = "";
  try { given = decodeURIComponent(String(req.get("x-access-password") || "")); } catch { /* invalid header */ }
  const a = Buffer.from(given), b = Buffer.from(settings.accessPassword);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: "Невірний пароль доступу.", code: "password" });
}

/* ---------- Ліміти запитів до Claude ---------- */
const hits = new Map();
let day = new Date().toISOString().slice(0, 10);
let dayCount = 0;

function takeQuota(req, res) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= settings.dailyLimit) {
    res.status(429).json({ error: "Денний ліміт перевірок на сайті вичерпано. Спробуйте завтра." });
    return false;
  }
  const recent = (hits.get(req.ip) || []).filter(t => now - t < 3600e3);
  if (recent.length >= settings.rateLimitPerHour) {
    res.status(429).json({ error: "Ліміт перевірок на годину вичерпано. Спробуйте пізніше." });
    return false;
  }
  recent.push(now);
  hits.set(req.ip, recent);
  dayCount++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    const recent = list.filter(t => now - t < 3600e3);
    if (recent.length) hits.set(ip, recent); else hits.delete(ip);
  }
}, 10 * 60e3).unref();

/* ---------- Допоміжне ---------- */
const bad = (res, error) => res.status(400).json({ error });

function parseClasses(v) {
  if (!Array.isArray(v)) return null;
  const c = [...new Set(v.map(Number))].filter(n => Number.isInteger(n) && CLASSES.some(k => k.number === n));
  return c.length && c.length <= settings.maxClasses ? c.sort((a, b) => a - b) : null;
}

// Якщо відвідувач закрив сторінку чи натиснув «Зупинити», запит до Claude теж зупиняється
function abortOnClose(res) {
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctl.abort(); });
  return ctl.signal;
}

const wrap = fn => (req, res, next) =>
  fn(req, res).catch(err => {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    if (err instanceof ClaudeError) return res.status(err.status).json({ error: err.message });
    next(err);
  });

/* ---------- Маршрути ---------- */
app.get("/healthz", (req, res) => res.type("text").send("ok"));

app.get("/api/config", (req, res) => {
  res.json({
    version,
    classes: CLASSES,
    regions: REGIONS.map(({ id, label }) => ({ id, label })),
    angles: ANGLES.map(({ id, name }) => ({ id, name })),
    categories: CATEGORIES,
    aspects: ASPECTS,
    maxClasses: settings.maxClasses,
    passwordRequired: Boolean(settings.accessPassword)
  });
});

app.post("/api/analyze-image", checkPassword, wrap(async (req, res) => {
  const b = req.body || {};
  const image = typeof b.image === "string" ? b.image : "";
  if (!image || image.length > 3_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) return bad(res, "Зображення не надійшло або пошкоджене. Завантажте файл ще раз.");
  const classes = parseClasses(b.classes);
  if (!classes) return bad(res, `Оберіть від 1 до ${settings.maxClasses} класів МКТП.`);
  if (!takeQuota(req, res)) return;
  const visual = await analyzeImage(image, classes, abortOnClose(res));
  res.json({ visual });
}));

app.post("/api/search", checkPassword, wrap(async (req, res) => {
  const b = req.body || {};
  const angle = ANGLES.find(a => a.id === b.angle);
  if (!angle) return bad(res, "Невідомий напрям пошуку.");
  const classes = parseClasses(b.classes);
  if (!classes) return bad(res, `Оберіть від 1 до ${settings.maxClasses} класів МКТП.`);
  const word = clip(b.word, 100);
  const visual = sanitizeVisual(b.visual);
  if (!word && !visual) return bad(res, "Потрібне словесне позначення або опис зображення.");
  const region = REGIONS.find(r => r.id === b.region) || REGIONS[0];
  const allowed = parseAllowed(b.allowed);
  if (!takeQuota(req, res)) return;
  const out = await searchDirection({ angle, word, visual, classes, region, allowed }, abortOnClose(res));
  res.json(out);
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Такої адреси немає." }));

app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Зображення завелике. Завантажте менший файл." });
  if (err?.type === "entity.parse.failed") return bad(res, "Некоректний запит.");
  console.error(err);
  res.status(500).json({ error: "Внутрішня помилка сервера. Спробуйте ще раз." });
});

app.listen(settings.port, () => {
  console.log(`Сайт працює: http://localhost:${settings.port} (версія ${version}, модель ${settings.model})`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Увага: не задано ANTHROPIC_API_KEY — пошук не працюватиме.");
  if (!settings.accessPassword) console.warn("Пароль доступу не задано: сайтом може користуватися будь-хто.");
});
