import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function usage() {
  console.error("Usage: node scripts/import-calendars.mjs --india FILE --russia FILE [--additional-russia FILE] [--out data/events.json] [--archive data/archive_ids.json] [--today YYYY-MM-DD]");
  process.exit(2);
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) usage();
  args.set(key.slice(2), value);
}
if (!args.has("india") || !args.has("russia")) usage();

const today = args.get("today") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today must be YYYY-MM-DD");
const outPath = resolve(args.get("out") ?? "data/events.json");
const archivePath = resolve(args.get("archive") ?? "data/archive_ids.json");

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(raw) {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = splitCsvLine(lines.shift() ?? "");
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header, splitCsvLine(line)[index] ?? ""])));
}

function decodeHtml(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const hex = entity[1]?.toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function plainText(value) {
  return decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}

const russianMonths = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};
const iso = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function parseRussianDateRange(value) {
  const text = value.toLowerCase().replace(/\s+/g, " ").trim();
  const crossMonth = /^(\d{1,2})\s+([а-яё]+)\s*[–—-]\s*(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/u.exec(text);
  if (crossMonth) {
    const [, startDay, startMonth, endDay, endMonth, year] = crossMonth;
    if (!russianMonths[startMonth] || !russianMonths[endMonth]) throw new Error(`Unknown month: ${value}`);
    return { start_date: iso(year, russianMonths[startMonth], startDay), end_date: iso(year, russianMonths[endMonth], endDay) };
  }
  const sameMonth = /^(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?\s+([а-яё]+)\s+(\d{4})$/u.exec(text);
  if (!sameMonth) throw new Error(`Unsupported date range: ${value}`);
  const [, startDay, rawEndDay, month, year] = sameMonth;
  if (!russianMonths[month]) throw new Error(`Unknown month: ${value}`);
  return { start_date: iso(year, russianMonths[month], startDay), end_date: iso(year, russianMonths[month], rawEndDay ?? startDay) };
}

function stableImportedId(name, city, startDate) {
  const ascii = `${name}-${city}`.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
  const digest = createHash("sha256").update(`${name}|${city}|${startDate}`).digest("hex").slice(0, 10);
  return `${ascii || "event"}-${startDate}-${digest}`;
}

function parseMoscowArticles(raw) {
  const rows = [];
  for (const match of raw.matchAll(/<article\s+class=["']event["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const body = match[1] ?? "";
    const rawDates = plainText(/<div\s+class=["']date["'][^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i.exec(body)?.[1] ?? "");
    const dates = parseRussianDateRange(/\d{4}/.test(rawDates) ? rawDates : `${rawDates} 2026`);
    const name = plainText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(body)?.[1] ?? "");
    const where = plainText(/<div\s+class=["']where["'][^>]*>([\s\S]*?)<\/div>/i.exec(body)?.[1] ?? "");
    const description = plainText(/<p\s+class=["']desc["'][^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1] ?? "");
    const tag = plainText(/<span\s+class=["']tag["'][^>]*>([\s\S]*?)<\/span>/i.exec(body)?.[1] ?? "").toLocaleLowerCase("ru-RU");
    const officialUrl = decodeHtml(/<a[^>]+href=["']([^"']+)["']/i.exec(body)?.[1] ?? "");
    const category = tag.includes("культур") || name.toLocaleLowerCase("ru-RU").includes("cosmoscow")
      ? "culture"
      : /йога|практик|мантр|медитац/.test(tag) ? "practices" : "business";
    const city = "Москва";
    rows.push({ id: stableImportedId(name, city, dates.start_date), category, ...dates,
      name, city, venue: where === city ? undefined : where, description, official_url: officialUrl });
  }
  return rows;
}

function parseHtml(raw, geography) {
  const rows = [];
  const rowPattern = /<tr([^>]*)>([\s\S]*?)<\/tr>/gi;
  for (const match of raw.matchAll(rowPattern)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1] ?? "");
    if (!cells.length) continue;
    if (geography === "IN" && cells.length >= 7) {
      const dates = parseRussianDateRange(plainText(cells[1]));
      const name = plainText(cells[2]);
      const city = plainText(cells[3]);
      const officialUrl = decodeHtml(/href=["']([^"']+)["']/i.exec(cells[5])?.[1] ?? "");
      rows.push({ id: stableImportedId(name, city, dates.start_date), category: "business", ...dates,
        name, city, description: plainText(cells[4]), official_url: officialUrl });
    } else if (geography === "RU" && cells.length >= 6) {
      const dates = parseRussianDateRange(plainText(cells[0]));
      const name = plainText(cells[1]);
      const city = plainText(cells[2]);
      const rawCategory = /data-cat=["']([^"']+)["']/i.exec(attrs)?.[1] ?? "business";
      const category = rawCategory === "practice" ? "practices" : rawCategory;
      const officialUrl = decodeHtml(/href=["']([^"']+)["']/i.exec(cells[5])?.[1] ?? "");
      rows.push({ id: stableImportedId(name, city, dates.start_date), category, ...dates,
        name, city, description: plainText(cells[4]), official_url: officialUrl });
    }
  }
  if (!rows.length && geography === "RU") rows.push(...parseMoscowArticles(raw));
  if (!rows.length) throw new Error("HTML contains no supported event rows");
  return rows;
}

function canonicalForDedupe(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function words(value) {
  return new Set(value.normalize("NFKC").toLocaleLowerCase("ru-RU")
    .replace(/\b2026\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean));
}

function titleSimilarity(left, right) {
  const a = words(left);
  const b = words(right);
  const common = [...a].filter((word) => b.has(word)).length;
  const total = new Set([...a, ...b]).size;
  return total ? common / total : 0;
}

function sameEvent(left, right) {
  if (left.geography !== right.geography || left.city !== right.city) return false;
  const overlaps = left.start_date <= right.end_date && right.start_date <= left.end_date;
  if (!overlaps) return false;
  return canonicalForDedupe(left.official_url) === canonicalForDedupe(right.official_url) ||
    titleSimilarity(left.name, right.name) >= 0.35;
}

async function load(path, geography) {
  const raw = await readFile(resolve(path), "utf8");
  if (path.toLowerCase().endsWith(".csv")) return parseCsv(raw);
  if (path.toLowerCase().endsWith(".html") || path.toLowerCase().endsWith(".htm")) return parseHtml(raw, geography);
  const value = JSON.parse(raw);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.events)) return value.events;
  throw new Error(`${path}: expected a JSON array, {events: []}, or CSV`);
}

const aliases = {
  id: ["id", "event_id", "ID"], category: ["category", "категория"],
  start_date: ["start_date", "date", "дата начала"], end_date: ["end_date", "дата окончания"],
  name: ["name", "title", "название"], city: ["city", "город"], venue: ["venue", "площадка"],
  description: ["description", "описание"], official_url: ["official_url", "url", "официальная ссылка"],
  status: ["status", "статус"], added_at: ["added_at", "добавлено"], updated_at: ["updated_at", "обновлено"],
};
const pick = (row, key) => aliases[key].map((alias) => row[alias]).find((value) => value !== undefined && value !== "");

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (!match) return text;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeCategory(value) {
  const key = String(value ?? "business").trim().toLowerCase();
  return ({ "бизнес": "business", "культура": "culture", "практики": "practices" })[key] ?? key;
}

function normalizeStatus(value) {
  const key = String(value ?? "scheduled").trim().toLowerCase();
  return ({ "запланировано": "scheduled", "перенесено": "postponed", "отменено": "cancelled", "онлайн": "online" })[key] ?? key;
}

function normalize(row, geography) {
  const startDate = normalizeDate(pick(row, "start_date"));
  const event = { id: pick(row, "id"), geography, category: normalizeCategory(pick(row, "category")),
    start_date: startDate, end_date: normalizeDate(pick(row, "end_date") ?? startDate),
    name: pick(row, "name"), city: pick(row, "city"), venue: pick(row, "venue") || undefined,
    description: pick(row, "description"), official_url: pick(row, "official_url"),
    status: normalizeStatus(pick(row, "status")), added_at: normalizeDate(pick(row, "added_at") ?? today),
    updated_at: normalizeDate(pick(row, "updated_at") ?? today) };
  const required = ["id", "start_date", "end_date", "name", "city", "description", "official_url"];
  for (const key of required) if (!event[key]) throw new Error(`Missing ${key} in ${geography} row: ${JSON.stringify(row)}`);
  return event;
}

const baseIncoming = [
  ...(await load(args.get("india"), "IN")).map((row) => normalize(row, "IN")),
  ...(await load(args.get("russia"), "RU")).map((row) => normalize(row, "RU")),
];
const additionalIncoming = args.has("additional-russia")
  ? (await load(args.get("additional-russia"), "RU")).map((row) => normalize(row, "RU"))
  : [];
const byId = new Map();
let mergedDuplicates = 0;
for (const event of baseIncoming) {
  if (byId.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
  byId.set(event.id, event);
}
for (const event of additionalIncoming) {
  const sameId = byId.get(event.id);
  if (sameId && !sameEvent(sameId, event)) throw new Error(`Conflicting duplicate event id: ${event.id}`);
  if (sameId || [...byId.values()].some((existing) => sameEvent(existing, event))) {
    mergedDuplicates += 1;
    continue;
  }
  byId.set(event.id, event);
}

let archive = { version: 1, retention_days: 365, ids: [] };
try { archive = JSON.parse(await readFile(archivePath, "utf8")); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const archiveById = new Map(archive.ids.map((item) => [item.id, item]));
const horizon = new Date(`${today}T00:00:00Z`);
horizon.setUTCDate(horizon.getUTCDate() + 120);
const horizonDate = horizon.toISOString().slice(0, 10);
let outsideHorizon = 0;
for (const event of byId.values()) {
  if (event.end_date < today) { archiveById.set(event.id, { id: event.id, ended_on: event.end_date }); byId.delete(event.id); }
  else if (archiveById.has(event.id)) throw new Error(`Active event id is already archived: ${event.id}`);
  else if (event.start_date > horizonDate) { byId.delete(event.id); outsideHorizon += 1; }
}
const cutoff = new Date(`${today}T00:00:00Z`);
cutoff.setUTCDate(cutoff.getUTCDate() - archive.retention_days);
const cutoffDate = cutoff.toISOString().slice(0, 10);
const ids = [...archiveById.values()].filter((item) => item.ended_on >= cutoffDate)
  .sort((a, b) => a.ended_on.localeCompare(b.ended_on) || a.id.localeCompare(b.id));
const events = [...byId.values()].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));

await writeFile(outPath, `${JSON.stringify({ version: 1, generated_at: new Date().toISOString(), horizon_days: 120, events }, null, 2)}\n`);
await writeFile(archivePath, `${JSON.stringify({ version: 1, retention_days: archive.retention_days, ids }, null, 2)}\n`);
console.log(`Imported ${events.length} active events; merged ${mergedDuplicates} duplicates; archive contains ${ids.length} ids; skipped ${outsideHorizon} beyond 120 days.`);
