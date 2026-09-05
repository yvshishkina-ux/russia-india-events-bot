import { significantFingerprint, todayInMoscow } from "./catalog";
import { formatCard } from "./format";
import { loadArchive, loadEvents } from "./github";
import { sendMessage } from "./telegram";
import type { Event } from "./types";

type Mode = "bootstrap" | "monitor" | "scheduled";
type StateRow = { significant_fingerprint: string };

async function reserve(env: Env, event: Event, fingerprint: string, kind: "new" | "updated"): Promise<string | null> {
  const id = `${event.id}:${fingerprint.slice(0, 20)}`;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO published_versions
       (publication_id, event_id, significant_fingerprint, kind, status)
     VALUES (?, ?, ?, ?, 'processing')`,
  ).bind(id, event.id, fingerprint, kind).run();
  if ((result.meta.changes ?? 0) > 0) return id;
  const retry = await env.DB.prepare(
    `UPDATE published_versions
     SET status = 'processing', error = NULL, created_at = CURRENT_TIMESTAMP
     WHERE publication_id = ? AND (
       status = 'failed' OR (status = 'processing' AND created_at < datetime('now', '-15 minutes'))
     )`,
  ).bind(id).run();
  return (retry.meta.changes ?? 0) > 0 ? id : null;
}

export async function sync(env: Env, mode: Mode): Promise<{ events: number; new: number; updated: number; published: number }> {
  if (mode === "bootstrap") {
    const previousBootstrap = await env.DB.prepare(
      "SELECT id FROM sync_runs WHERE mode = 'bootstrap' LIMIT 1",
    ).first<{ id: number }>();
    if (previousBootstrap) throw new Error("Bootstrap has already been completed");
  }
  const [registry, archive] = await Promise.all([loadEvents(env), loadArchive(env)]);
  const archived = new Set(archive.ids.map((item) => item.id));
  const today = todayInMoscow();
  let newCount = 0;
  let updatedCount = 0;
  let published = 0;
  const seen: string[] = [];
  for (const event of registry.events) {
    if (event.end_date < today) continue;
    seen.push(event.id);
    if (archived.has(event.id)) throw new Error(`Active event is also archived: ${event.id}`);
    const fingerprint = await significantFingerprint(event);
    const previous = await env.DB.prepare(
      "SELECT significant_fingerprint FROM event_state WHERE event_id = ?",
    ).bind(event.id).first<StateRow>();
    if (mode === "bootstrap") {
      await env.DB.prepare(
        `INSERT INTO event_state (event_id, significant_fingerprint)
         VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET
           significant_fingerprint = excluded.significant_fingerprint,
           last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
      ).bind(event.id, fingerprint).run();
      continue;
    }
    const kind = !previous
      ? (event.status === "cancelled" ? null : "new")
      : previous.significant_fingerprint !== fingerprint ? "updated" : null;
    if (kind === "new") newCount += 1;
    if (kind === "updated") updatedCount += 1;
    if (kind) {
      const publicationId = await reserve(env, event, fingerprint, kind);
      if (publicationId) {
        try {
          await sendMessage(env, env.TELEGRAM_CHANNEL_ID, formatCard(event, kind));
          await env.DB.prepare(
            "UPDATE published_versions SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE publication_id = ?",
          ).bind(publicationId).run();
          published += 1;
        } catch (error) {
          await env.DB.prepare(
            "UPDATE published_versions SET status = 'failed', error = ? WHERE publication_id = ?",
          ).bind(String(error).slice(0, 500), publicationId).run();
          throw error;
        }
      }
    }
    await env.DB.prepare(
      `INSERT INTO event_state (event_id, significant_fingerprint)
       VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET
         significant_fingerprint = excluded.significant_fingerprint,
         last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
    ).bind(event.id, fingerprint).run();
  }
  if (seen.length) {
    const placeholders = seen.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE event_state SET removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)
       WHERE event_id NOT IN (${placeholders})`,
    ).bind(...seen).run();
  } else {
    await env.DB.prepare(
      "UPDATE event_state SET removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)",
    ).run();
  }
  await env.DB.prepare(
    "INSERT INTO sync_runs (mode, event_count, new_count, updated_count, published_count) VALUES (?, ?, ?, ?, ?)",
  ).bind(mode, registry.events.length, newCount, updatedCount, published).run();
  return { events: registry.events.length, new: newCount, updated: updatedCount, published };
}
