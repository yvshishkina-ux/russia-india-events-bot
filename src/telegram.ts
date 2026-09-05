import { activeEvents, todayInMoscow, visibleEvents } from "./catalog";
import { carouselMenu, categoryMenu, cityMenu, cityToken, formatCard, geographyChoiceMenu, geographyMenu, mainMenu, monthMenu, type InlineKeyboard } from "./format";
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

async function editMessage(
  env: Env, chatId: string, messageId: number, text: string, keyboard?: InlineKeyboard,
): Promise<void> {
  await request(env, "editMessageText", { chat_id: chatId, message_id: messageId, text,
    parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}) });
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

async function showCarousel(
  env: Env, chatId: string, messageId: number, events: Event[], prefix: string, requestedIndex: number,
  emptyText = "В этом разделе предстоящих событий пока нет.",
): Promise<void> {
  if (!events.length) {
    await editMessage(env, chatId, messageId, emptyText, mainMenu());
    return;
  }
  const index = Math.min(Math.max(requestedIndex, 0), events.length - 1);
  const event = events[index];
  if (!event) return;
  await editMessage(env, chatId, messageId, formatCard(event), carouselMenu(prefix, index, events.length, event));
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
  const messageId = query?.message?.message_id;
  if (!query || chatId === undefined || messageId === undefined) return;
  await answerCallback(env, query.id);
  const data = query.data ?? "";
  if (data === "noop") return;
  if (data === "home") return editMessage(env, String(chatId), messageId, "Выберите раздел календаря:", mainMenu());
  if (data === "geo:RU") return editMessage(env, String(chatId), messageId, "Индийская тематика в России:", geographyMenu("RU"));
  if (data === "geo:IN") return editMessage(env, String(chatId), messageId, "Деловые мероприятия в Индии:", geographyMenu("IN"));
  if (data === "categories:RU") return editMessage(env, String(chatId), messageId, "Выберите категорию:", categoryMenu());
  if (data.startsWith("cities:")) {
    const geography = data.split(":")[1];
    if (!geography || !validGeo(geography)) return;
    return editMessage(env, String(chatId), messageId, "Выберите город:", cityMenu(activeEvents(events), geography));
  }
  if (data === "soon") return editMessage(env, String(chatId), messageId, "Где показать ближайшие события?", geographyChoiceMenu("soon"));
  if (data.startsWith("soon:")) {
    const [, geo, rawIndex] = data.split(":");
    if (!geo || !validGeo(geo)) return editMessage(env, String(chatId), messageId, "Где показать ближайшие события?", geographyChoiceMenu("soon"));
    const index = Math.max(0, Number.parseInt(rawIndex ?? "0", 10) || 0);
    const upcoming = activeEvents(events)
      .filter((event) => event.geography === geo && event.start_date >= todayInMoscow())
      .slice(0, 24);
    return showCarousel(env, String(chatId), messageId, upcoming, `soon:${geo}`, index);
  }
  if (data === "recent") {
    return showCarousel(env, String(chatId), messageId, await recentlyAddedEvents(env, events), "recent", 0,
      "Новых событий после запуска бота пока нет.");
  }
  if (data.startsWith("recent:")) {
    const index = Number(data.split(":")[1] ?? "0");
    return showCarousel(env, String(chatId), messageId, await recentlyAddedEvents(env, events), "recent", index,
      "Новых событий после запуска бота пока нет.");
  }
  if (data.startsWith("months:")) {
    const [, geo, rawCategory] = data.split(":");
    if (!geo || !validGeo(geo) || !rawCategory) return;
    if (rawCategory !== "all" && !validCategory(rawCategory)) return;
    const category = validCategory(rawCategory) ? rawCategory : undefined;
    return editMessage(env, String(chatId), messageId, "Выберите месяц в календаре на 120 дней:", monthMenu(activeEvents(events), geo, category));
  }
  if (data.startsWith("list:")) {
    const [, geo, rawCategory, month, rawIndex] = data.split(":");
    if (!geo || !validGeo(geo) || !rawCategory || !month || !/^\d{4}-\d{2}$/.test(month)) return;
    if (rawCategory !== "all" && !validCategory(rawCategory)) return;
    const category = validCategory(rawCategory) ? rawCategory : undefined;
    const index = Math.max(0, Number.parseInt(rawIndex ?? "0", 10) || 0);
    const prefix = `list:${geo}:${rawCategory}:${month}`;
    return showCarousel(env, String(chatId), messageId, visibleEvents(events, { geography: geo, category, month }), prefix, index);
  }
  if (data.startsWith("city:")) {
    const [, geo, token, rawIndex] = data.split(":");
    if (!geo || !validGeo(geo) || !token) return;
    const city = [...new Set(activeEvents(events).filter((event) => event.geography === geo).map((event) => event.city))]
      .find((item) => cityToken(item) === token);
    if (!city) return editMessage(env, String(chatId), messageId, "Список городов обновился. Выберите город ещё раз:", cityMenu(activeEvents(events), geo));
    const index = Math.max(0, Number.parseInt(rawIndex ?? "0", 10) || 0);
    return showCarousel(env, String(chatId), messageId, visibleEvents(events, { geography: geo, city }), `city:${geo}:${token}`, index);
  }
}
