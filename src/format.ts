import type { Category, Event, Geography } from "./types";

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

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
  const category = event.category === "business" ? "Бизнес" : event.category === "culture" ? "Культура" : "Практики";
  const noticeText = notice === "new" ? "🆕 <b>НОВОЕ СОБЫТИЕ</b>\n\n" :
    notice === "updated" ? "⚠️ <b>СУЩЕСТВЕННОЕ ИЗМЕНЕНИЕ</b>\n\n" : "";
  const state = event.status === "postponed" ? "\n⚠️ Перенесено" :
    event.status === "cancelled" ? "\n⛔ Отменено" : event.status === "online" ? "\n💻 Онлайн" : "";
  const venue = event.venue ? `, ${escape(event.venue)}` : "";
  const result = `${noticeText}${flag} <b>${escape(event.name)}</b>\n${category}\n\n` +
    `📅 ${dateRange(event)}\n📍 ${escape(event.city)}${venue}${state}\n\n` +
    `${escape(event.description)}\n\n<a href="${escape(event.official_url)}">Официальный сайт</a>`;
  return result.slice(0, 4000);
}

export function mainMenu(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "🇮🇳 События в Индии", callback_data: "geo:IN" }],
    [{ text: "🇷🇺 Индия в России", callback_data: "geo:RU" }],
    [{ text: "📅 Ближайшие", callback_data: "soon" }, { text: "🆕 Новые", callback_data: "recent" }],
  ] };
}

export function categoryMenu(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "Все", callback_data: "months:RU:all" }],
    [{ text: "Бизнес", callback_data: "months:RU:business" }, { text: "Культура", callback_data: "months:RU:culture" }],
    [{ text: "Практики", callback_data: "months:RU:practices" }],
    [{ text: "← Главное меню", callback_data: "home" }],
  ] };
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

export function pageMenu(prefix: string, page: number, hasMore: boolean): InlineKeyboard {
  const row: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) row.push({ text: "← Назад", callback_data: `${prefix}:${page - 1}` });
  if (hasMore) row.push({ text: "Дальше →", callback_data: `${prefix}:${page + 1}` });
  return { inline_keyboard: [row, [{ text: "⌂ Главное меню", callback_data: "home" }]].filter((item) => item.length) };
}
