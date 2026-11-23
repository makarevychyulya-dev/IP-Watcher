"use strict";
// Логіка пошуку: напрями, типи порушень і правила оцінки для Claude.
// Саме тут змінюються критерії, за якими система шукає й оцінює збіги.

// Типи можливих порушень (ключ використовує Claude, назва показується на сайті)
const CATEGORIES = {
  identical_mark: "Ідентична торговельна марка",
  similar_mark: "Схоже позначення",
  marketplace_offer: "Пропозиція на маркетплейсі",
  unauthorized_seller: "Можливий неавторизований продавець",
  third_party_use: "Використання третьою особою",
  other: "Інший можливий випадок"
};

// За чим саме збігається результат
const ASPECTS = {
  name: "назва",
  visual: "зображення або дизайн",
  goods: "товари обраного класу"
};

// Напрями пошуку. Кожен напрям — окремий запит до Claude з вебпошуком,
// усі напрями виконуються паралельно. Щоб додати напрям, допишіть об’єкт сюди.
const ANGLES = [
  {
    id: "marks",
    name: "Ідентичні та схожі позначення",
    task: "Find identical or confusingly similar signs used by others for the same or related goods/services: the same name; spelling variants; Latin/Cyrillic transliteration; phonetically similar names; translations; the name with added generic words; logos or packaging with a similar design (search with the visual description phrases). Prefer the categories identical_mark and similar_mark."
  },
  {
    id: "market",
    name: "Маркетплейси й інтернет-магазини",
    task: "Find offers of goods or services sold under this sign or a similar one on marketplaces and online shops in the territory. Look for possible counterfeits, lookalike packaging, sellers that are not among the authorised ones, and suspiciously cheap offers. Prefer the categories marketplace_offer and unauthorized_seller."
  },
  {
    id: "third",
    name: "Компанії, домени й соцмережі",
    task: "Find use of the sign by third parties outside marketplaces: company, shop, restaurant or brand names; domain names; social media accounts and pages; advertising; competitors' products with a similar name or design. Prefer the categories third_party_use and other."
  }
];

const ANALYST_INTRO = "You are a trademark watch analyst. Search the web for possible infringements of the trademark below.";

function buildRules(maxResults) {
  const cats = Object.keys(CATEGORIES).join(" | ");
  const aspects = Object.keys(ASPECTS).map(a => `"${a}"`).join(",");
  return `RULES
- Use the web_search tool. Run several different searches: vary the wording and the language (Ukrainian, English, and the territory's main language).
- If the trademark image contains words, treat them as the word element as well.
- Judge each relevant page as a trademark attorney would, using the likelihood-of-confusion test: similarity of the signs (visual, phonetic, conceptual) and identity or similarity of the goods/services to the classes above. Identical sign + identical goods/services = high. Similar sign + same or closely related goods = medium or high. Similar sign + unrelated goods = low, unless the mark is widely known.
- Do not report: the owner's official sites and authorised sellers listed above, news articles, reviews, trademark registers, dictionaries, or coincidental matches in unrelated fields.
- Use only URLs that appeared in your search results, copied exactly. Never invent or edit a URL.
- You cannot see images on the pages. Judge visual similarity only from what the search results say, and mention this in the reason when it matters.

OUTPUT
Reply with ONLY a JSON object, with no text before or after it and no markdown:
{"results":[{"url":"https://...","title":"page title, max 100 characters","category":"${cats}","sign_found":"the sign as used on the page, max 50 characters","match":[${aspects}],"risk":"high | medium | low","reason":"in Ukrainian, max 300 characters: why this may infringe the trademark"}]}
At most ${maxResults} results, most significant first. "match" lists only the aspects that actually match. If nothing relevant is found, reply {"results":[]}.`;
}

function visionPrompt(classesText) {
  return `You are helping a trademark watch tool. The image is a trademark (logo, label or packaging) that its owner wants to protect. Nice classes: ${classesText}.
Describe it so that a text web search can find visually similar marks. Reply with ONLY a JSON object, no other text:
{"text":"words or letters visible in the mark, exactly as written, or an empty string","description":"in Ukrainian, max 200 characters: the visual composition","elements":["up to 5 distinctive visual elements, in English, 1-3 words each"],"colors":["up to 4 main colours, in Ukrainian"],"search_terms":["up to 5 short English search phrases to find similar logos or packaging, e.g. red fox head logo coffee"]}`;
}

module.exports = { CATEGORIES, ASPECTS, ANGLES, ANALYST_INTRO, buildRules, visionPrompt };
