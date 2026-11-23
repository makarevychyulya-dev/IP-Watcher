"use strict";
// Території пошуку. label показується на сайті, prompt отримує Claude:
// тут зазначено мови пошуку й маркетплейси, які треба охопити.
// Щоб додати територію, допишіть новий об’єкт з унікальним id.

module.exports = [
  {
    id: "all",
    label: "Усюди",
    prompt: "worldwide. Cover global marketplaces (Amazon, eBay, AliExpress, Temu, Etsy, Alibaba) and Ukrainian ones (Rozetka, Prom.ua, OLX.ua, Epicentrk.ua)"
  },
  {
    id: "ua",
    label: "Україна",
    prompt: "Ukraine. Search in Ukrainian and English; cover Rozetka, Prom.ua, OLX.ua, Epicentrk.ua, Allo.ua, Kasta.ua and Instagram/Facebook shops"
  },
  {
    id: "eu",
    label: "Європейський Союз",
    prompt: "the European Union. Search in English and major EU languages; cover Amazon (.de, .fr, .it, .es, .pl), Allegro, eBay, Etsy, Zalando, Bol.com"
  },
  {
    id: "us",
    label: "США",
    prompt: "the United States. Cover Amazon.com, eBay, Walmart, Etsy, Target"
  }
];
