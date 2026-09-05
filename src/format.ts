import type { Category, Event, Geography } from "./types";

type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
  "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

function dateRange(event: Event): string {
  if (event.start_date === event.end_date) return formatDate(event.start_date);
  return `${formatDate(event.start_date)} — ${formatDate(event.end_date)}`;
}

export function formatCard(event: Event, notice?: "new" | "updated"): string {
  const flag = event.geography === "IN" ? "🇮🇳" : "🇷🇺";
  const geography = event.geography === "IN" ? "Индия" : "Россия";
  const category = event.category === "business" ? "💼 Бизнес" : event.category === "culture" ? "🎭 Культура" : "🧘 Практики";
  const noticeText = notice === "new" ? "🆕 <b>НОВОЕ СОБЫТИЕ</b>\n\n" :
    notice === "updated" ? "⚠️ <b>СУЩЕСТВЕННОЕ ИЗМЕНЕНИЕ</b>\n\n" : "";
  const state = event.status === "postponed" ? "\n⚠️ Перенесено" :
    event.status === "cancelled" ? "\n⛔ Отменено" : event.status === "online" ? "\n💻 Онлайн" : "";
  const venue = event.venue ? `\n🏛 ${escape(event.venue)}` : "";
  const result = `${noticeText}${flag} <b>${escape(event.name)}</b>\n<i>${category} · ${geography}</i>\n\n` +
    `📅 <b>${dateRange(event)}</b>\n📍 ${escape(event.city)}${venue}${state}\n\n` +
    `${escape(event.description)}\n\n🔗 <a href="${escape(event.official_url)}">Официальный сайт</a>`;
  return result.slice(0, 4000);
}

function shareUrl(event: Event): string {
  const text = `${event.name}\n📅 ${dateRange(event)}\n📍 ${event.city}`;
  const params = new URLSearchParams({ url: event.official_url, text });
  return `https://t.me/share/url?${params.toString()}`;
}

export function notificationMenu(event: Event): InlineKeyboard {
  return { inline_keyboard: [[
    { text: "↗️ Поделиться", url: shareUrl(event) },
    { text: "🌐 Открыть сайт", url: event.official_url },
  ]] };
}

export function carouselMenu(prefix: string, index: number, total: number, event: Event): InlineKeyboard {
  const navigation: InlineButton[] = [];
  if (index > 0) navigation.push({ text: "←", callback_data: `${prefix}:${index - 1}` });
  navigation.push({ text: `${index + 1} из ${total}`, callback_data: "noop" });
  if (index + 1 < total) navigation.push({ text: "→", callback_data: `${prefix}:${index + 1}` });
  return { inline_keyboard: [
    navigation,
    [
      { text: "↗️ Поделиться", url: shareUrl(event) },
      { text: "🌐 Сайт", url: event.official_url },
    ],
    [{ text: "⌂ Главное меню", callback_data: "home" }],
  ] };
}

export function mainMenu(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "🇮🇳 Бизнес в Индии", callback_data: "geo:IN" }],
    [{ text: "🇷🇺 Индия в России", callback_data: "geo:RU" }],
    [{ text: "📅 Ближайшие", callback_data: "soon" }, { text: "🆕 Новые", callback_data: "recent" }],
  ] };
}

export function geographyChoiceMenu(prefix: "soon"): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "🇮🇳 В Индии", callback_data: `${prefix}:IN:0` }],
    [{ text: "🇷🇺 В России", callback_data: `${prefix}:RU:0` }],
    [{ text: "← Главное меню", callback_data: "home" }],
  ] };
}

export function geographyMenu(geography: Geography): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "🗓 Календарь на 120 дней", callback_data: `months:${geography}:all` }],
    [{ text: "🏙 Выбрать город", callback_data: `cities:${geography}` }],
    ...(geography === "RU" ? [[{ text: "🏷 Выбрать категорию", callback_data: "categories:RU" }]] : []),
    [{ text: "← Главное меню", callback_data: "home" }],
  ] };
}

export function categoryMenu(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "Все", callback_data: "months:RU:all" }],
    [{ text: "Бизнес", callback_data: "months:RU:business" }, { text: "Культура", callback_data: "months:RU:culture" }],
    [{ text: "Практики", callback_data: "months:RU:practices" }],
    [{ text: "← К разделу России", callback_data: "geo:RU" }],
  ] };
}

export function cityToken(city: string): string {
  let hash = 0x811c9dc5;
  for (const char of city.normalize("NFC").toLocaleLowerCase("ru-RU")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function cityMenu(events: Event[], geography: Geography): InlineKeyboard {
  const cities = [...new Set(activeCities(events, geography))]
    .sort((a, b) => a === "Москва" ? -1 : b === "Москва" ? 1 : a.localeCompare(b, "ru"));
  const buttons = cities.map((city) => ({ text: city, callback_data: `city:${geography}:${cityToken(city)}:0` }));
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  rows.push([{ text: "← Назад", callback_data: `geo:${geography}` }]);
  return { inline_keyboard: rows };
}

function activeCities(events: Event[], geography: Geography): string[] {
  return events.filter((event) => event.geography === geography).map((event) => event.city);
}

export function monthMenu(events: Event[], geography: Geography, category?: Category): InlineKeyboard {
  const months = [...new Set(events.filter((event) => event.geography === geography && (!category || event.category === category))
    .map((event) => event.start_date.slice(0, 7)))].sort();
  const token = category ?? "all";
  const rows = months.map((month) => {
    const [year, number] = month.split("-").map(Number);
    return [{ text: `${MONTHS_SHORT[(number ?? 1) - 1]} ${year}`, callback_data: `list:${geography}:${token}:${month}:0` }];
  });
  rows.push([{ text: "← Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}
