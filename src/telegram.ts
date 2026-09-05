import { activeEvents, visibleEvents } from "./catalog";
import { categoryMenu, formatCard, mainMenu, monthMenu, pageMenu, type InlineKeyboard } from "./format";
import type { Category, Event, Geography, TelegramUpdate } from "./types";

type ApiResult = { ok?: boolean; description?: string };

async function request(env: Env, method: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json() as ApiResult;
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method}: ${result.description ?? response.status}`);
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

async function showPage(env: Env, chatId: string, events: Event[], prefix: string, page: number): Promise<void> {
  const configured = Number.parseInt(env.PAGE_SIZE, 10);
  const size = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 8) : 6;
  const start = page * size;
  const items = events.slice(start, start + size);
  if (!items.length) {
    await sendMessage(env, chatId, "В этом разделе предстоящих событий пока нет.", mainMenu());
    return;
  }
  for (const event of items) await sendMessage(env, chatId, formatCard(event));
  await sendMessage(env, chatId, `Показано ${start + 1}–${start + items.length} из ${events.length}.`,
    pageMenu(prefix, page, start + size < events.length));
}

export async function handleUpdate(env: Env, update: TelegramUpdate, events: Event[]): Promise<void> {
  const message = update.message;
  if (message) {
    await sendMessage(env, String(message.chat.id),
      "<b>Россия × Индия | События</b>\n\nВыберите раздел календаря:", mainMenu());
    return;
  }
  const query = update.callback_query;
  const chatId = query?.message?.chat.id;
  if (!query || chatId === undefined) return;
  await answerCallback(env, query.id);
  const data = query.data ?? "";
  if (data === "home") return sendMessage(env, String(chatId), "Выберите раздел календаря:", mainMenu());
  if (data === "geo:RU") return sendMessage(env, String(chatId), "Выберите категорию:", categoryMenu());
  if (data === "geo:IN") return sendMessage(env, String(chatId), "Выберите месяц:", monthMenu(activeEvents(events), "IN"));
  if (data === "soon") return showPage(env, String(chatId), activeEvents(events).slice(0, 24), "soon", 0);
  if (data.startsWith("soon:")) {
    const page = Number(data.split(":")[1] ?? "0");
    return showPage(env, String(chatId), activeEvents(events).slice(0, 24), "soon", page);
  }
  if (data === "recent") {
    const days = Math.min(Math.max(Number.parseInt(env.RECENT_DAYS, 10) || 14, 1), 60);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return showPage(env, String(chatId), activeEvents(events).filter((event) => event.added_at >= cutoff), "recent", 0);
  }
  if (data.startsWith("recent:")) {
    const days = Math.min(Math.max(Number.parseInt(env.RECENT_DAYS, 10) || 14, 1), 60);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const page = Number(data.split(":")[1] ?? "0");
    return showPage(env, String(chatId), activeEvents(events).filter((event) => event.added_at >= cutoff), "recent", page);
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
}
