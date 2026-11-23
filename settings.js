"use strict";
// Основні налаштування сайту.
// Значення з process.env задаються змінними середовища на хостингу (Render → Environment).

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
  port: int(process.env.PORT, 3000),

  // Модель Claude і версія інструмента вебпошуку
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  apiUrl: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
  webSearchTool: "web_search_20250305",

  // Обсяг пошуку за одним напрямом
  maxSearchesPerDirection: 5,   // скільки пошукових запитів Claude може зробити
  maxResultsPerDirection: 8,    // скільки збігів повертати
  maxTokensSearch: 4000,
  maxTokensVision: 800,
  requestTimeoutMs: 180000,     // 3 хвилини на один напрям

  maxClasses: 3,                // скільки класів МКТП можна обрати одночасно

  // Захист від надмірних витрат
  rateLimitPerHour: int(process.env.RATE_LIMIT_PER_HOUR, 30), // запитів до Claude з однієї IP-адреси за годину (одна перевірка = 3–4 запити)
  dailyLimit: int(process.env.DAILY_LIMIT, 300),              // запитів до Claude на весь сайт за добу
  accessPassword: process.env.ACCESS_PASSWORD || ""           // якщо задано, сайт питатиме пароль
};
