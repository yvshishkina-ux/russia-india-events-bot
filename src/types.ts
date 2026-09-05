export const GEOGRAPHIES = ["IN", "RU"] as const;
export const CATEGORIES = ["business", "culture", "practices"] as const;
export const EVENT_STATUSES = ["scheduled", "postponed", "cancelled", "online"] as const;

export type Geography = (typeof GEOGRAPHIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type Event = {
  id: string;
  geography: Geography;
  category: Category;
  start_date: string;
  end_date: string;
  name: string;
  city: string;
  venue?: string;
  description: string;
  official_url: string;
  status: EventStatus;
  added_at: string;
  updated_at: string;
};

export type EventsRegistry = {
  version: 1;
  generated_at: string;
  horizon_days: 120;
  events: Event[];
};

export type ArchiveRegistry = {
  version: 1;
  retention_days: number;
  ids: Array<{ id: string; ended_on: string }>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > max) return undefined;
  return value.trim();
}

function date(value: unknown): string | undefined {
  const result = text(value, 10);
  if (!result || !/^\d{4}-\d{2}-\d{2}$/.test(result)) return undefined;
  const parsed = new Date(`${result}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result
    ? result
    : undefined;
}

function url(value: unknown): string | undefined {
  const result = text(value, 1_000);
  if (!result) return undefined;
  try {
    const parsed = new URL(result);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseEvent(value: unknown): Event | undefined {
  if (!record(value)) return undefined;
  const id = text(value.id, 120);
  const geography = GEOGRAPHIES.find((item) => item === value.geography);
  const category = CATEGORIES.find((item) => item === value.category);
  const startDate = date(value.start_date);
  const endDate = date(value.end_date ?? value.start_date);
  const name = text(value.name, 300);
  const city = text(value.city, 120);
  const description = text(value.description, 1_500);
  const officialUrl = url(value.official_url);
  const status = EVENT_STATUSES.find((item) => item === value.status);
  const addedAt = date(value.added_at);
  const updatedAt = date(value.updated_at);
  if (
    !id || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || !geography || !category ||
    !startDate || !endDate || endDate < startDate || !name || !city ||
    !description || !officialUrl || !status || !addedAt || !updatedAt
  ) return undefined;
  return {
    id, geography, category, start_date: startDate, end_date: endDate, name, city,
    venue: text(value.venue, 300), description, official_url: officialUrl,
    status, added_at: addedAt, updated_at: updatedAt,
  };
}

export function parseEventsRegistry(value: unknown): EventsRegistry {
  if (!record(value) || value.version !== 1 || value.horizon_days !== 120 ||
      typeof value.generated_at !== "string" || !Array.isArray(value.events)) {
    throw new Error("Malformed events registry");
  }
  const events = value.events.map(parseEvent);
  if (events.some((item) => !item)) throw new Error("Invalid event in registry");
  const result = events as Event[];
  const ids = new Set<string>();
  for (const event of result) {
    if (ids.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
    ids.add(event.id);
  }
  return { version: 1, generated_at: value.generated_at, horizon_days: 120,
    events: result.sort((a, b) => a.start_date.localeCompare(b.start_date)) };
}

export function parseArchiveRegistry(value: unknown): ArchiveRegistry {
  if (!record(value) || value.version !== 1 || typeof value.retention_days !== "number" ||
      !Array.isArray(value.ids)) throw new Error("Malformed archive registry");
  const ids = value.ids.map((item) => {
    if (!record(item)) throw new Error("Invalid archive item");
    const id = text(item.id, 120);
    const endedOn = date(item.ended_on);
    if (!id || !endedOn) throw new Error("Invalid archive item");
    return { id, ended_on: endedOn };
  });
  if (new Set(ids.map((item) => item.id)).size !== ids.length) {
    throw new Error("Duplicate archived event id");
  }
  return { version: 1, retention_days: value.retention_days, ids };
}

export type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};
