"use strict";
// Звернення до Claude API та розбір відповідей із вебпошуком.

const settings = require("../config/settings");

class ClaudeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "ClaudeError";
    this.status = status;
  }
}

function userMessage(status, data) {
  const detail = String(data?.error?.message || "");
  if (/credit|balance|billing/i.test(detail)) return "На рахунку Claude API закінчилися кошти. Поповніть баланс у Console.";
  if (status === 401 || status === 403) return "Сервер не має доступу до Claude API. Перевірте ключ ANTHROPIC_API_KEY.";
  if (status === 429) return "Вичерпано ліміт Claude API. Спробуйте за кілька хвилин.";
  if (status === 400) return "Claude API відхилив запит. Подробиці є в журналі сервера.";
  return "Сервіс аналізу тимчасово недоступний. Спробуйте за кілька хвилин.";
}

// Надсилає запит до Claude. Якщо пошук довгий і API повертає pause_turn,
// продовжує ту саму відповідь (до трьох разів).
async function callClaude({ content, search = false, maxTokens = 1000, signal }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeError("На сервері не задано ключ ANTHROPIC_API_KEY.", 500);
  }
  const messages = [{ role: "user", content }];
  const blocks = [];

  for (let round = 0; round < 3; round++) {
    const body = { model: settings.model, max_tokens: maxTokens, messages };
    if (search) {
      body.tools = [{ type: settings.webSearchTool, name: "web_search", max_uses: settings.maxSearchesPerDirection }];
    }
    const signals = [AbortSignal.timeout(settings.requestTimeoutMs)];
    if (signal) signals.push(signal);

    let res, data;
    try {
      res = await fetch(settings.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals)
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e?.name === "TimeoutError") throw new ClaudeError("Сервіс аналізу не відповів вчасно. Спробуйте ще раз.", 504);
      throw new ClaudeError("Не вдалося з’єднатися із сервісом аналізу. Спробуйте ще раз.", 502);
    }

    if (!res.ok || !data || data.type === "error") {
      console.error("Claude API error:", res.status, JSON.stringify(data?.error || data));
      throw new ClaudeError(userMessage(res.status, data), res.status === 429 ? 503 : 502);
    }
    blocks.push(...(data.content || []));
    if (data.stop_reason === "max_tokens") console.warn("Claude reply hit max_tokens; salvaging complete results.");
    if (data.stop_reason !== "pause_turn") break;
    messages.splice(1, messages.length - 1, { role: "assistant", content: blocks.slice() });
  }
  return blocks;
}

// Текст відповіді після останнього пошуку (саме там Claude пише підсумковий JSON)
function finalText(blocks) {
  let last = -1;
  blocks.forEach((b, i) => {
    if (b.type === "web_search_tool_result" || b.type === "server_tool_use") last = i;
  });
  const after = blocks.slice(last + 1).filter(b => b.type === "text").map(b => b.text).join("");
  return after.trim() ? after : blocks.filter(b => b.type === "text").map(b => b.text).join("");
}

function allText(blocks) {
  return blocks.filter(b => b.type === "text").map(b => b.text).join("");
}

function parseObject(text) {
  const t = String(text).replace(/```json|```/g, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

// Дістає масив results; якщо відповідь обірвалася, рятує всі завершені об’єкти
function extractItems(text) {
  const whole = parseObject(text);
  if (whole && Array.isArray(whole.results)) return whole.results;
  const t = String(text);
  const k = t.indexOf("[", Math.max(0, t.indexOf('"results"')));
  if (k < 0) return [];
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = k + 1; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(t.slice(start, i + 1))); } catch { /* skip broken object */ }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

function normUrl(u, noQuery = false) {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    const path = safeDecode(x.pathname).replace(/\/+$/, "").toLowerCase();
    return host + path + (noQuery ? "" : safeDecode(x.search));
  } catch { return ""; }
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// Усі адреси, які справді повернув пошук, і пошукові запити Claude
function searchMeta(blocks) {
  const full = new Map(), path = new Map(), titles = new Map(), queries = [];
  const add = (url, title) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const a = normUrl(url), b = normUrl(url, true);
    if (a && !full.has(a)) full.set(a, url);
    if (b && !path.has(b)) path.set(b, url);
    if (title && !titles.has(url)) titles.set(url, title);
  };
  for (const b of blocks) {
    if (b.type === "server_tool_use" && b.input?.query) queries.push(String(b.input.query));
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) add(r.url, r.title);
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) add(c.url, c.title);
    }
  }
  return { full, path, titles, queries };
}

module.exports = { ClaudeError, callClaude, finalText, allText, parseObject, extractItems, normUrl, hostOf, searchMeta };
