// Інтерфейс сайту. Пошук виконує сервер (server.js); тут — форма й показ результатів.
(() => {
"use strict";
const $ = id => document.getElementById(id);

const RISK = {
  high:   { label: "Високий ризик",  short: "Високий",  rank: 0 },
  medium: { label: "Середній ризик", short: "Середній", rank: 1 },
  low:    { label: "Низький ризик",  short: "Низький",  rank: 2 }
};
const MODE_NOTE = {
  word: "Шукає ідентичні та схожі за звучанням, написанням і значенням назви для товарів обраного класу.",
  image: "Система опише візуальні ознаки знака й шукатиме логотипи та упаковку зі схожим дизайном.",
  combo: "Назва, зображення й клас разом: найповніша перевірка."
};
const PW_KEY = "tw-access-password";

let CONFIG = null; // класи, території, напрями й типи порушень приходять із сервера
const state = {
  mode: "word", classes: [], imgB64: null, imgURL: null,
  running: false, ctl: null, steps: [], results: [], queries: [],
  visual: null, spec: null, fatal: null, usedImage: false,
  filterRisk: "all", filterCat: "all"
};

const catOrder = () => Object.keys(CONFIG?.categories || {});
const catLabel = id => CONFIG?.categories?.[id] || "Інший можливий випадок";
const aspectLabel = id => CONFIG?.aspects?.[id] || id;
const regionLabel = id => (CONFIG?.regions || []).find(r => r.id === id)?.label || "";
const maxClasses = () => CONFIG?.maxClasses || 3;

/* ---------- Server API ---------- */
function getPassword(){ try { return sessionStorage.getItem(PW_KEY) || ""; } catch { return ""; } }
function savePassword(p){ try { sessionStorage.setItem(PW_KEY, p); } catch {} }

async function api(path, body, signal){
  const headers = { "Content-Type": "application/json" };
  const pw = getPassword();
  if (pw) headers["x-access-password"] = encodeURIComponent(pw);
  const res = await fetch(path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, signal });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok){
    const e = new Error(data?.error || `Сервер повернув помилку ${res.status}. Спробуйте ще раз.`);
    e.status = res.status;
    throw e;
  }
  return data;
}
function errMsg(e){
  if (e?.name === "AbortError") return "Зупинено.";
  if (e instanceof TypeError) return "Немає з’єднання із сервером. Перевірте інтернет і спробуйте ще раз.";
  return e?.message || "Невідома помилка.";
}

/* ---------- Form ---------- */
function setMode(m){
  state.mode = m;
  $("fWord").hidden = m === "image";
  $("fImage").hidden = m === "word";
  $("modeNote").textContent = MODE_NOTE[m];
  hideError();
}
document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", e => setMode(e.target.value)));

function renderClasses(){
  const q = $("clsSearch").value.trim().toLowerCase();
  const list = $("clsList");
  list.replaceChildren();
  const all = CONFIG?.classes || [];
  const items = all.filter(({ number, description }) => !q || (/^\d+$/.test(q) ? String(number).startsWith(q) : description.toLowerCase().includes(q)));
  for (const { number: n, description: d } of items){
    const li = document.createElement("li");
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = n;
    cb.checked = state.classes.includes(n);
    cb.disabled = !cb.checked && state.classes.length >= maxClasses();
    cb.addEventListener("change", () => toggleClass(n));
    const num = el("span", "cls-n", n);
    const desc = el("span", null, d);
    lab.append(cb, num, desc); li.append(lab); list.append(li);
  }
  if (!items.length){
    list.append(el("li", "cls-none", `Класів за цим запитом немає. Введіть номер від 1 до ${all.length || 45} або іншу назву товару.`));
  }
  const chosen = $("chosen");
  chosen.replaceChildren();
  for (const n of state.classes){
    const b = el("button", "chip");
    b.type = "button";
    b.setAttribute("aria-label", `Прибрати клас ${n}`);
    const x = el("span", null, "✕"); x.setAttribute("aria-hidden", "true");
    b.append(document.createTextNode(`Клас ${n} `), x);
    b.addEventListener("click", () => toggleClass(n));
    chosen.append(b);
  }
}
function toggleClass(n){
  const i = state.classes.indexOf(n);
  if (i >= 0) state.classes.splice(i, 1);
  else if (state.classes.length < maxClasses()) state.classes.push(n);
  state.classes.sort((a, b) => a - b);
  hideError();
  renderClasses();
}
$("clsSearch").addEventListener("input", renderClasses);

function prepImage(file){
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
      const s = Math.min(1, max / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u);
      const d = c.toDataURL("image/jpeg", 0.9);
      resolve({ b64: d.split(",")[1], url: d });
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("decode")); };
    img.src = u;
  });
}
async function setFile(file){
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){ showError("Цей формат не підтримується. Завантажте PNG, JPG, WebP або GIF."); return; }
  if (file.size > 10 * 1024 * 1024){ showError("Файл більший за 10 МБ. Зменште його й завантажте знову."); return; }
  try {
    const { b64, url } = await prepImage(file);
    state.imgB64 = b64; state.imgURL = url;
    $("preview").src = url; $("preview").hidden = false;
    $("dropEmpty").hidden = true; $("clearImg").hidden = false;
    hideError();
  } catch {
    showError("Не вдалося прочитати зображення. Спробуйте інший файл.");
  }
}
$("file").addEventListener("change", e => setFile(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("is-over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("is-over"); }));
drop.addEventListener("drop", e => setFile(e.dataTransfer?.files?.[0]));
$("clearImg").addEventListener("click", () => {
  state.imgB64 = null; state.imgURL = null; $("file").value = "";
  $("preview").hidden = true; $("preview").removeAttribute("src");
  $("dropEmpty").hidden = false; $("clearImg").hidden = true;
});

function showError(msg){ const e = $("formError"); e.textContent = msg; e.hidden = false; }
function hideError(){ $("formError").hidden = true; }
function validate(){
  if (state.mode !== "image" && !$("word").value.trim()) return "Введіть словесне позначення торговельної марки.";
  if (state.mode !== "word" && !state.imgB64) return "Завантажте зображення торговельної марки.";
  if (!state.classes.length) return "Оберіть щонайменше один клас МКТП.";
  if (CONFIG?.passwordRequired && !$("password").value.trim()) return "Введіть пароль доступу.";
  return null;
}

/* ---------- Search ---------- */
function setStep(id, status, note){
  const s = state.steps.find(x => x.id === id);
  if (s){ s.status = status; s.note = note; }
  renderAll();
}
function setRunningUI(on){
  $("go").disabled = on || !CONFIG;
  $("go").textContent = on ? "Триває пошук…" : "Шукати збіги";
  $("stop").hidden = !on;
}
function merge(items){
  for (const it of items){
    const ex = state.results.find(r => r.url === it.url);
    if (!ex){ state.results.push(it); continue; }
    if (RISK[it.risk].rank < RISK[ex.risk].rank){ ex.risk = it.risk; ex.reason = it.reason || ex.reason; ex.category = it.category; }
    ex.match = [...new Set([...ex.match, ...it.match])];
    if (!ex.sign && it.sign) ex.sign = it.sign;
  }
  const order = catOrder();
  state.results.sort((a, b) => RISK[a.risk].rank - RISK[b.risk].rank || order.indexOf(a.category) - order.indexOf(b.category));
}

async function run(){
  if (!CONFIG) return;
  const err = validate();
  if (err){ showError(err); return; }
  hideError();
  if (CONFIG.passwordRequired) savePassword($("password").value.trim());

  const mode = state.mode;
  const word = mode !== "image" ? $("word").value.trim() : "";
  const useImg = mode !== "word";
  const region = $("region").value;
  const classes = [...state.classes];
  const allowed = $("allowed").value;

  Object.assign(state, { results: [], queries: [], visual: null, fatal: null, usedImage: useImg, filterRisk: "all", filterCat: "all" });
  state.spec = { word, img: useImg ? state.imgURL : null, classes, region };
  state.steps = [];
  if (useImg) state.steps.push({ id: "vision", name: "Аналіз зображення знака", status: "wait" });
  CONFIG.angles.forEach(a => state.steps.push({ id: a.id, name: a.name, status: "wait" }));

  const ctl = new AbortController();
  state.ctl = ctl; state.running = true;
  setRunningUI(true);
  $("intro").hidden = true; $("run").hidden = false;
  renderAll();
  if (window.matchMedia("(max-width: 899px)").matches){
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("results").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  let visual = null;
  if (useImg){
    setStep("vision", "run");
    try {
      visual = (await api("/api/analyze-image", { image: state.imgB64, classes }, ctl.signal)).visual;
      state.visual = visual;
      setStep("vision", "done");
    } catch (e){
      if (ctl.signal.aborted){ finish(); return; }
      setStep("vision", "fail", errMsg(e));
      if (e.status === 401 || e.status === 429 || !word){
        state.fatal = e.status === 401 ? "Невірний пароль доступу. Перевірте його й запустіть пошук ще раз." : errMsg(e);
        finish(); return;
      }
    }
  }

  await Promise.allSettled(CONFIG.angles.map(async a => {
    setStep(a.id, "run");
    try {
      const r = await api("/api/search", { angle: a.id, word, visual, classes, region, allowed }, ctl.signal);
      merge(r.results || []);
      state.queries.push(...(r.queries || []));
      setStep(a.id, "done", (r.results || []).length);
    } catch (e){
      if (e.status === 401) state.fatal = "Невірний пароль доступу. Перевірте його й запустіть пошук ще раз.";
      setStep(a.id, ctl.signal.aborted ? "stop" : "fail", errMsg(e));
    }
  }));
  finish();
}
function finish(){
  state.running = false; state.ctl = null;
  state.steps.forEach(s => { if (s.status === "wait" || s.status === "run") s.status = "stop"; });
  const searchSteps = state.steps.filter(s => s.id !== "vision");
  if (!state.fatal && searchSteps.length && searchSteps.every(s => s.status === "fail")){
    state.fatal = `Пошук не вдався. ${searchSteps[0].note}`;
  }
  setRunningUI(false);
  renderAll();
}
$("go").addEventListener("click", run);
$("stop").addEventListener("click", () => state.ctl?.abort());

/* ---------- Render ---------- */
function plural(n, f){ const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return f[2]; if (b > 1 && b < 5) return f[1]; if (b === 1) return f[0]; return f[2]; }
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function linkTo(href, text){ const a = el("a", null, text); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; }

function renderSpec(){
  const box = $("spec"); box.replaceChildren();
  const sp = state.spec; if (!sp) return;
  const mark = el("div", "spec-mark");
  if (sp.img){ const im = document.createElement("img"); im.src = sp.img; im.alt = "Зображення знака, за яким іде пошук"; mark.append(im); }
  if (sp.word) mark.append(el("span", "spec-word", sp.word));
  else mark.append(el("span", "spec-figurative", state.visual?.text ? `Зображувальний знак із написом «${state.visual.text}»` : "Зображувальний знак"));
  const meta = el("dl", "spec-meta");
  const row = (k, v) => { const d = el("div"); d.style.display = "contents"; d.append(el("dt", null, k), el("dd", null, v)); meta.append(d); };
  row("(511)", `${sp.classes.length > 1 ? "Класи" : "Клас"} ${sp.classes.join(", ")}`);
  row("Територія", regionLabel(sp.region));
  box.append(mark, meta);
}
function renderSteps(){
  const ul = $("steps"); ul.replaceChildren();
  for (const s of state.steps){
    const li = el("li", `step ${s.status}`);
    const name = el("span", "step-name"); name.append(el("span", "dot"), el("span", null, s.name));
    let st = "Очікує";
    if (s.status === "run") st = s.id === "vision" ? "Аналізує…" : "Шукає…";
    if (s.status === "done") st = s.id === "vision" ? "Готово" : (s.note ? `${s.note} ${plural(s.note, ["збіг", "збіги", "збігів"])}` : "Збігів немає");
    if (s.status === "fail") st = `Не вдалося. ${s.note}`;
    if (s.status === "stop") st = "Зупинено";
    li.append(name, el("span", "step-status", st));
    ul.append(li);
  }
}
function renderVisual(){
  const v = state.visual, box = $("visual");
  box.hidden = !v; box.replaceChildren();
  if (!v) return;
  box.append(el("h3", null, "Як система прочитала зображення"));
  if (v.text) box.append(el("p", null, `Напис у знаку: «${v.text}»`));
  if (v.description) box.append(el("p", null, v.description));
  if (v.colors?.length) box.append(el("p", null, `Кольори: ${v.colors.join(", ")}`));
}
function filtered(){
  return state.results.filter(r => (state.filterRisk === "all" || r.risk === state.filterRisk) && (state.filterCat === "all" || r.category === state.filterCat));
}
function renderResults(){
  const total = state.results.length;
  const head = $("resHead"), ul = $("matches"), empty = $("empty");
  ul.replaceChildren();
  empty.classList.remove("is-error");

  if (state.fatal){
    head.hidden = true; empty.hidden = false; empty.classList.add("is-error"); empty.textContent = state.fatal; return;
  }
  if (!total){
    head.hidden = true;
    empty.hidden = state.running;
    empty.textContent = "Схожих використань не знайдено. Спробуйте інший варіант написання, додайте суміжний клас або оберіть «Усюди».";
    return;
  }
  empty.hidden = true; head.hidden = false;
  $("resTitle").textContent = `${state.running ? "Поки знайдено" : "Знайдено"} ${total} ${plural(total, ["потенційний збіг", "потенційні збіги", "потенційних збігів"])}`;
  const cnt = k => state.results.filter(r => r.risk === k).length;
  $("resBreak").textContent = `Високий ризик: ${cnt("high")}. Середній: ${cnt("medium")}. Низький: ${cnt("low")}.`;

  const seg = $("riskSeg"); seg.replaceChildren();
  [["all", "Усі"], ...Object.entries(RISK).map(([k, v]) => [k, v.short])].forEach(([k, label]) => {
    const b = el("button", null, label); b.type = "button";
    b.setAttribute("aria-pressed", String(state.filterRisk === k));
    b.addEventListener("click", () => { state.filterRisk = k; renderResults(); });
    seg.append(b);
  });
  const sel = $("catFilter"); sel.replaceChildren();
  const present = catOrder().filter(c => state.results.some(r => r.category === c));
  if (state.filterCat !== "all" && !present.includes(state.filterCat)) state.filterCat = "all";
  [["all", "Усі типи"], ...present.map(c => [c, catLabel(c)])].forEach(([v, t]) => { const o = el("option", null, t); o.value = v; sel.append(o); });
  sel.value = state.filterCat;

  const rows = filtered();
  if (!rows.length){
    empty.hidden = false; empty.textContent = "За цими фільтрами збігів немає. Оберіть «Усі», щоб побачити весь перелік.";
  }
  for (const r of rows){
    const li = el("li", `match ${r.risk}`);
    const top = el("div", "m-top");
    top.append(el("span", "risk", RISK[r.risk].label), el("span", "cat", catLabel(r.category)));
    const h = el("h3"); h.append(linkTo(r.url, r.title));
    li.append(top, h, el("p", "host", r.host));
    const facts = el("dl", "facts");
    if (r.sign){ const d = el("div"); d.append(el("dt", null, "Позначення на сторінці:"), el("dd", null, `«${r.sign}»`)); facts.append(d); }
    if (r.match.length){ const d = el("div"); d.append(el("dt", null, "Збіг:"), el("dd", null, r.match.map(aspectLabel).join(", "))); facts.append(d); }
    if (facts.children.length) li.append(facts);
    if (r.reason){ const p = el("p", "why"); p.append(el("b", null, "Чому це може бути порушенням. "), document.createTextNode(r.reason)); li.append(p); }
    ul.append(li);
  }
}
$("catFilter").addEventListener("change", e => { state.filterCat = e.target.value; renderResults(); });

function renderNotes(){
  const box = $("notes");
  box.hidden = state.running || !state.spec;
  box.replaceChildren();
  if (box.hidden) return;
  if (state.usedImage){
    const p = el("p", null, "Візуальну схожість система оцінює за описом знака й текстом сторінок, а не попіксельно. Відкрийте сторінку, щоб порівняти зображення, або перевірте знак через ");
    p.append(linkTo("https://lens.google.com", "Google Lens"), document.createTextNode(" чи "), linkTo("https://tineye.com", "TinEye"), document.createTextNode("."));
    box.append(p);
  }
  const reg = el("p", null, "Щоб звірити збіги з реєстраціями, скористайтеся базами ");
  reg.append(linkTo("https://branddb.wipo.int", "WIPO Global Brand Database"), document.createTextNode(", "), linkTo("https://www.tmdn.org/tmview", "TMview"), document.createTextNode(" та "), linkTo("https://sis.nipo.gov.ua", "НОІВ"), document.createTextNode("."));
  box.append(reg);
  const qs = [...new Set(state.queries)];
  if (qs.length){
    const d = el("details"); d.append(el("summary", null, `Пошукові запити системи (${qs.length})`));
    const ul = el("ul"); qs.forEach(q => ul.append(el("li", null, q))); d.append(ul); box.append(d);
  }
  box.append(el("p", null, "Це попередній автоматичний скринінг, а не юридичний висновок. Чи є використання порушенням, остаточно визначає патентний повірений або суд з урахуванням реєстрації, дати пріоритету та фактичних обставин."));
}
function renderAll(){ renderSpec(); renderSteps(); renderVisual(); renderResults(); renderNotes(); }

/* ---------- Export ---------- */
function slug(s){ return (s || "znak").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "znak"; }
function flash(btn, text, back){ btn.textContent = text; setTimeout(() => { btn.textContent = back; }, 2000); }

$("csvBtn").addEventListener("click", () => {
  const head = ["Ризик", "Тип", "Назва сторінки", "Посилання", "Позначення на сторінці", "Збіг", "Чому це може бути порушенням"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head, ...filtered().map(r => [RISK[r.risk].label, catLabel(r.category), r.title, r.url, r.sign, r.match.map(aspectLabel).join(", "), r.reason])];
  const csv = "\uFEFF" + lines.map(l => l.map(q).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `zbihy-${slug(state.spec?.word || state.visual?.text)}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("copyBtn").addEventListener("click", async () => {
  const sp = state.spec || {};
  const title = `Перевірка торговельної марки ${sp.word ? `«${sp.word}»` : "(зображувальний знак)"}, клас МКТП ${(sp.classes || []).join(", ")}, територія: ${regionLabel(sp.region)}`;
  const body = filtered().map((r, i) => `${i + 1}. ${RISK[r.risk].label}. ${catLabel(r.category)}. ${r.title}\n   ${r.url}${r.sign ? `\n   Позначення на сторінці: «${r.sign}»` : ""}${r.reason ? `\n   Чому це може бути порушенням: ${r.reason}` : ""}`).join("\n\n");
  const text = `${title}\n\n${body}`;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    try { const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.append(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch {}
  }
  flash($("copyBtn"), ok ? "Скопійовано" : "Не вдалося скопіювати", "Копіювати перелік");
});

/* ---------- Init ---------- */
async function init(){
  setMode("word");
  try {
    CONFIG = await api("/api/config");
  } catch {
    showError("Не вдалося завантажити налаштування сайту. Оновіть сторінку за хвилину.");
    return;
  }
  const sel = $("region");
  CONFIG.regions.forEach(r => { const o = el("option", null, r.label); o.value = r.id; sel.append(o); });
  $("clsHint").textContent = `Можна обрати до ${maxClasses()} класів.`;
  if (CONFIG.passwordRequired){ $("fPassword").hidden = false; $("password").value = getPassword(); }
  $("version").textContent = `Версія ${CONFIG.version}`;
  renderClasses();
  setRunningUI(false);
}
init();
})();
