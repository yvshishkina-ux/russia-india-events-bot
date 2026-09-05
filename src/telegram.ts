import { activeEvents, todayInMoscow, visibleEvents } from "./catalog";
import { categoryMenu, cityMenu, cityToken, formatCard, geographyChoiceMenu, geographyMenu, mainMenu, monthMenu, pageMenu, type InlineKeyboard } from "./format";
import type { Category, Event, Geography, TelegramUpdate } from "./types";

type ApiResult = { ok?: boolean; description?: string };

export class TelegramApiError extends Error {
  constructor(public status: number, description: string) {
    super(`Telegram API: ${description}`);
  }
}

async function request(env: Env, method: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json() as ApiResult;
  if (!response.ok || !result.ok) throw new TelegramApiError(response.status, result.description ?? String(response.status));
}

export async function sendMessage(env: Env, chatId: string, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await request(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML",
    link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: keyboard } : {}) });
}

async function answerCallback(env: Env, id: string): Promise<void> {
  await request(env, "answerCallbackQuery", { callback_query_id: id });
}

const validGeo = (value: string): value is Geography => value === "IN" || value === "RU";
const validCategory = (value: string): value is Category => ["business", "culture", "practices"].includes(value);

async function recentlyAddedEvents(env: Env, events: Event[]): Promise<Event[]> {
  const days = Math.min(Math.max(Number.parseInt(env.RECENT_DAYS, 10) || 14, 1), 60);
  const rows = await env.DB.prepare(
    "SELECT DISTINCT event_id FROM published_versions WHERE kind = 'new' AND created_at >= datetime('now', ?)",
  ).bind(`-${days} days`).all<{ event_id: string }>();
  const ids = new Set(rows.results.map((row) => row.event_id));
  return activeEvents(events).filter((event) => ids.has(event.id));
}

async function showPage(
  env: Env, chatId: string, events: Event[], prefix: string, page: number,
  emptyText = "В этом разделе предстоящих событий пока нет.",
): Promise<void> {
  const configured = Number.parseInt(env.PAGE_SIZE, 10);
  const size = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 8) : 6;
  const start = page * size;
  const items = events.slice(start, start + size);
  if (!items.length) {
    await sendMessage(env, chatId, emptyText, mainMenu());
    return;
  }
  for (const event of items) await sendMessage(env, chatId, formatCard(event));
  await sendMessage(env, chatId, `Показано ${start + 1}–${start + items.length} из ${events.length}.`,
    pageMenu(prefix, page, start + size < events.length));
}

export async function handleUpdate(env: Env, update: TelegramUpdate, events: Event[]): Promise<void> {
  const message = update.message;
  if (message) {
    const chatId = String(message.chat.id);
    const command = (message.text ?? "").trim().split(/\s+/, 1)[0]?.toLocaleLowerCase("ru-RU");
    if (command === "/stop") {
      await env.DB.prepare(
        "UPDATE subscribers SET active = 0, unsubscribed_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
      ).bind(chatId).run();
      await sendMessage(env, chatId,
        "Рассылка остановлена. Каталог останется доступен; чтобы снова получать новые события, отправьте /start.");
      return;
    }
    if (command === "/start") {
      await env.DB.prepare(
        `INSERT INTO subscribers (chat_id) VALUES (?)
         ON CONFLICT(chat_id) DO UPDATE SET active = 1, unsubscribed_at = NULL, last_seen_at = CURRENT_TIMESTAMP`,
      ).bind(chatId).run();
    }
    await sendMessage(env, chatId,
      "<b>Индия: бизнес и события</b>\n\nДеловые мероприятия в Индии и события индийской тематики в России. Новые и существенно изменённые события будут приходить сюда автоматически.\n\nВыберите раздел:", mainMenu());
    return;
  }
  const query = update.callback_query;
  const chatId = query?.message?.chat.id;
  if (!query || chatId === undefined) return;
  await answerCallback(env, query.id);
  const data = query.data ?? "";
  if (data === "home") return sendMessage(env, String(chatId), "Выберите раздел календаря:", mainMenu());
  if (data === "geo:RU") return sendMessage(env, String(chatId), "Индийская тематика в России:", geographyMenu("RU"));
  if (data === "geo:IN") return sendMessage(env, String(chatId), "Деловые мероприятия в Индии:", geographyMenu("IN"));
  if (data === "categories:RU") return sendMessage(env, String(chatId), "Выберите категорию:", categoryMenu());
  if (data.startsWith("cities:")) {
    const geography = data.split(":")[1];
    if (!geography || !validGeo(geography)) return;
    return sendMessage(env, String(chatId), "Выберите город:", cityMenu(activeEvents(events), geography));
  }
  if (data === "soon") return sendMessage(env, String(chatId), "Где показать ближайшие события?", geographyChoiceMenu("soon"));
  if (data.startsWith("soon:")) {
    const [, geo, rawPage] = data.split(":");
    if (!geo || !validGeo(geo)) return sendMessage(env, String(chatId), "Где показать ближайшие события?", geographyChoiceMenu("soon"));
    const page = Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0);
    const upcoming = activeEvents(events)
      .filter((event) => event.geography === geo && event.start_date >= todayInMoscow())
      .slice(0, 24);
    return showPage(env, String(chatId), upcoming, `soon:${geo}`, page);
  }
  if (data === "recent") {
    return showPage(env, String(chatId), await recentlyAddedEvents(env, events), "recent", 0,
      "Новых событий после запуска бота пока нет.");
  }
  if (data.startsWith("recent:")) {
    const page = Number(data.split(":")[1] ?? "0");
    return showPage(env, String(chatId), await recentlyAddedEvents(env, events), "recent", page,
      "Новых событий после запуска бота пока нет.");
  }
  if (data.startsWith("months:")) {
    const [, geo, rawCategory] = data.split(":");
    if (!geo || !validGeo(geo) || !rawCategory) return;
    if (rawCategory !== "all" && !validCategory(rawCategory)) return;
    const category = validCategory(rawCategory) ? rawCategory : undefined;
    return sendMessage(env, String(chatId), "Выберите месяц:", monthMenu(activeEvents(events), geo, category));
  }
  if (data.startsWith("list:")) {
    const [, geo, rawCategory, month, rawPage] = data.split(":");
    if (!geo || !validGeo(geo) || !rawCategory || !month || !/^\d{4}-\d{2}$/.test(month)) return;
    if (rawCategory !== "all" && !validCategory(rawCategory)) return;
    const category = validCategory(rawCategory) ? rawCategory : undefined;
    const page = Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0);
    const prefix = `list:${geo}:${rawCategory}:${month}`;
    return showPage(env, String(chatId), visibleEvents(events, { geography: geo, category, month }), prefix, page);
  }
  if (data.startsWith("city:")) {
    const [, geo, token, rawPage] = data.split(":");
    if (!geo || !validGeo(geo) || !token) return;
    const city = [...new Set(activeEvents(events).filter((event) => event.geography === geo).map((event) => event.city))]
      .find((item) => cityToken(item) === token);
    if (!city) return sendMessage(env, String(chatId), "Список городов обновился. Выберите город ещё раз:", cityMenu(activeEvents(events), geo));
    const page = Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0);
    return showPage(env, String(chatId), visibleEvents(events, { geography: geo, city }), `city:${geo}:${token}`, page);
  }
}
