import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeEvents, significantMaterial, visibleEvents } from "../src/catalog.ts";
import { carouselMenu, cityToken, formatCard } from "../src/format.ts";
import { parseEventsRegistry, type Event } from "../src/types.ts";

const event: Event = {
  id: "sample-2026", geography: "RU", category: "business", start_date: "2026-10-15",
  end_date: "2026-10-16", name: "Sample", city: "Казань", description: "Description",
  official_url: "https://example.com/event?utm_source=test", status: "scheduled",
  added_at: "2026-09-05", updated_at: "2026-09-05",
};

test("registry rejects duplicate event ids", () => {
  assert.throws(() => parseEventsRegistry({ version: 1, generated_at: "x", horizon_days: 120,
    events: [event, event] }), /Duplicate event id/);
});

test("committed event registry is valid", async () => {
  const raw = JSON.parse(await readFile(new URL("../data/events.json", import.meta.url), "utf8"));
  const registry = parseEventsRegistry(raw);
  assert.equal(registry.events.length, 170);
  assert.equal(registry.events.filter((event) => event.geography === "IN").length, 146);
  assert.equal(registry.events.filter((event) => event.geography === "RU").length, 24);
});

test("only end date decides whether a scheduled event is still active", () => {
  assert.equal(activeEvents([event], "2026-10-16").length, 1);
  assert.equal(activeEvents([event], "2026-10-17").length, 0);
});

test("catalog filters geography, category, and start month", () => {
  assert.equal(visibleEvents([event], { geography: "RU", category: "business", month: "2026-10" }, "2026-09-05").length, 1);
  assert.equal(visibleEvents([event], { geography: "IN" }, "2026-09-05").length, 0);
});

test("catalog filters by city and city callback token is deterministic", () => {
  assert.equal(visibleEvents([event], { geography: "RU", city: "Казань" }, "2026-09-05").length, 1);
  assert.equal(visibleEvents([event], { geography: "RU", city: "Москва" }, "2026-09-05").length, 0);
  assert.equal(cityToken("Москва"), cityToken("МОСКВА"));
  assert.notEqual(cityToken("Москва"), cityToken("Казань"));
});

test("significant comparison ignores description but includes date city status and official url", () => {
  const baseline = significantMaterial(event);
  assert.equal(significantMaterial({ ...event, description: "Rewritten" }), baseline);
  assert.notEqual(significantMaterial({ ...event, city: "Москва" }), baseline);
  assert.notEqual(significantMaterial({ ...event, start_date: "2026-10-14" }), baseline);
  assert.equal(significantMaterial({ ...event, official_url: "https://example.com/event?utm_campaign=x" }), baseline);
  assert.notEqual(significantMaterial({ ...event, status: "postponed" }), baseline);
});

test("carousel renders one card with navigation and sharing", () => {
  const keyboard = carouselMenu("city:RU:test", 1, 3, event);
  assert.match(formatCard(event), /📅 <b>15 октября 2026 — 16 октября 2026<\/b>/);
  assert.deepEqual(keyboard.inline_keyboard[0].map((button) => button.text), ["←", "2 из 3", "→"]);
  assert.match(keyboard.inline_keyboard[1][0]?.url ?? "", /^https:\/\/t\.me\/share\/url\?/);
  for (const row of keyboard.inline_keyboard) {
    for (const button of row) {
      if (button.callback_data) assert.ok(new TextEncoder().encode(button.callback_data).length <= 64);
    }
  }
});
