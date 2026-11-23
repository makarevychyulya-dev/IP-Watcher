"use strict";
// Аналіз зображення знака, пошук за напрямами й перевірка знайдених збігів.

const settings = require("../config/settings");
const CLASSES = require("../config/classes");
const { CATEGORIES, ASPECTS, ANALYST_INTRO, buildRules, visionPrompt } = require("../config/search");
const { ClaudeError, callClaude, finalText, allText, parseObject, extractItems, normUrl, hostOf, searchMeta } = require("./claude");

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v, n, len) => (Array.isArray(v) ? v.map(x => clip(x, len)).filter(Boolean).slice(0, n) : []);

function classesText(classes) {
  return classes.map(n => `${n} (${CLASSES.find(c => c.number === n)?.description || ""})`).join("; ");
}

// Опис зображення (від Claude або повернений сайтом) — лише допустимі поля й довжини
function sanitizeVisual(o) {
  if (!o || typeof o !== "object") return null;
  const v = {
    text: clip(o.text, 80),
    description: clip(o.description, 260),
    elements: list(o.elements, 5, 40),
    colors: list(o.colors, 4, 30),
    terms: list(o.terms ?? o.search_terms, 5, 80)
  };
  return v.text || v.description || v.terms.length ? v : null;
}

// Офіційні сайти й авторизовані продавці: по одному на рядок або через кому
function parseAllowed(text) {
  return String(text ?? "")
    .split(/[\n,]+/)
    .map(s => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""))
    .filter(Boolean)
    .slice(0, 30)
    .map(s => s.slice(0, 200));
}

function isAllowed(url, allowed) {
  const n = normUrl(url, true);
  const host = n.split("/")[0];
  return allowed.some(a => (a.includes("/") ? n === a || n.startsWith(a + "/") : host === a || host.endsWith("." + a)));
}

async function analyzeImage(imageB64, classes, signal) {
  const blocks = await callClaude({
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
      { type: "text", text: visionPrompt(classesText(classes)) }
    ],
    maxTokens: settings.maxTokensVision,
    signal
  });
  const visual = sanitizeVisual(parseObject(allText(blocks)));
  if (!visual) throw new ClaudeError("Не вдалося розібрати опис зображення. Спробуйте ще раз або інший файл.", 502);
  return visual;
}

function buildContext({ word, visual, classes, region, allowed }) {
  const lines = ["TRADEMARK TO PROTECT"];
  lines.push(word ? `Word element: "${word}"` : "Word element: none (figurative mark)");
  if (visual) {
    lines.push(
      `Figurative element, described from the owner's image: text in the mark: ${visual.text || "none"}; ` +
      `composition: ${visual.description || "n/a"}; distinctive elements: ${visual.elements.join(", ") || "n/a"}; ` +
      `colours: ${visual.colors.join(", ") || "n/a"}; search phrases for similar designs: ${visual.terms.join(" | ") || "n/a"}`
    );
  }
  lines.push(`Nice classes: ${classesText(classes)}`);
  lines.push(`Territory: ${region.prompt}`);
  lines.push(`Owner's official sites and authorised sellers (never report these): ${allowed.length ? allowed.join(", ") : "not provided"}`);
  return lines.join("\n");
}

// Залишає лише збіги з адресами, які справді знайшов пошук
function cleanItem(it, meta, allowed) {
  if (!it || typeof it !== "object") return null;
  const raw = String(it.url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const url = meta.full.get(normUrl(raw)) || meta.path.get(normUrl(raw, true));
  if (!url || isAllowed(url, allowed)) return null;
  return {
    url,
    host: hostOf(url),
    title: clip(it.title, 140) || clip(meta.titles.get(url), 140) || hostOf(url),
    category: CATEGORIES[it.category] ? it.category : "other",
    risk: ["high", "medium", "low"].includes(it.risk) ? it.risk : "medium",
    sign: clip(it.sign_found, 60),
    match: Array.isArray(it.match) ? [...new Set(it.match.filter(m => ASPECTS[m]))] : [],
    reason: clip(it.reason, 400)
  };
}

async function searchDirection({ angle, word, visual, classes, region, allowed }, signal) {
  const prompt = `${ANALYST_INTRO}\n\n${buildContext({ word, visual, classes, region, allowed })}\n\nTASK\n${angle.task}\n\n${buildRules(settings.maxResultsPerDirection)}`;
  const blocks = await callClaude({ content: prompt, search: true, maxTokens: settings.maxTokensSearch, signal });
  const meta = searchMeta(blocks);
  const results = extractItems(finalText(blocks))
    .map(it => cleanItem(it, meta, allowed))
    .filter(Boolean)
    .slice(0, settings.maxResultsPerDirection);
  return { results, queries: meta.queries };
}

module.exports = { analyzeImage, searchDirection, sanitizeVisual, parseAllowed, clip };
