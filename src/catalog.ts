import type { Category, Event, Geography } from "./types";

export function todayInMoscow(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function activeEvents(events: Event[], today = todayInMoscow()): Event[] {
  return events.filter((event) => event.end_date >= today && event.status !== "cancelled");
}

export function visibleEvents(
  events: Event[],
  filter: { geography?: Geography; category?: Category; month?: string },
  today = todayInMoscow(),
): Event[] {
  return activeEvents(events, today).filter((event) =>
    (!filter.geography || event.geography === filter.geography) &&
    (!filter.category || event.category === filter.category) &&
    (!filter.month || event.start_date.slice(0, 7) === filter.month),
  );
}

export function significantMaterial(event: Event): string {
  return [event.start_date, event.end_date, event.city.trim().toLocaleLowerCase("ru-RU"),
    event.status, canonicalUrl(event.official_url)].join("|");
}

export async function significantFingerprint(event: Event): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(significantMaterial(event)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "yclid"].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
