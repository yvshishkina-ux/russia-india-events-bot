import { significantFingerprint, todayInMoscow } from "./catalog";
import { formatCard, notificationMenu } from "./format";
import { loadArchive, loadEvents } from "./github";
import { sendMessage, TelegramApiError } from "./telegram";
import type { Event } from "./types";

type Mode = "bootstrap" | "monitor" | "scheduled";
type StateRow = { significant_fingerprint: string };
type StateMapRow = StateRow & { event_id: string };
type SubscriberRow = { chat_id: string };

async function runBatches(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  const batchSize = 75;
  for (let index = 0; index < statements.length; index += batchSize) {
    await env.DB.batch(statements.slice(index, index + batchSize));
  }
}

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
  const stateRows = await env.DB.prepare(
    "SELECT event_id, significant_fingerprint FROM event_state",
  ).all<StateMapRow>();
  const state = new Map(stateRows.results.map((row) => [row.event_id, row]));
  const today = todayInMoscow();
  let newCount = 0;
  let updatedCount = 0;
  let published = 0;
  const stateUpdates: D1PreparedStatement[] = [];
  for (const event of registry.events) {
    if (event.end_date < today) continue;
    if (archived.has(event.id)) throw new Error(`Active event is also archived: ${event.id}`);
    const fingerprint = await significantFingerprint(event);
    const previous = state.get(event.id);
    if (mode === "bootstrap") {
      stateUpdates.push(env.DB.prepare(
        `INSERT INTO event_state (event_id, significant_fingerprint)
         VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET
           significant_fingerprint = excluded.significant_fingerprint,
           last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
      ).bind(event.id, fingerprint));
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
        const subscribers = await env.DB.prepare(
          "SELECT chat_id FROM subscribers WHERE active = 1 ORDER BY subscribed_at",
        ).all<SubscriberRow>();
        const failures: string[] = [];
        for (const subscriber of subscribers.results) {
          const delivered = await env.DB.prepare(
            "SELECT chat_id FROM notification_deliveries WHERE publication_id = ? AND chat_id = ?",
          ).bind(publicationId, subscriber.chat_id).first<{ chat_id: string }>();
          if (delivered) continue;
          try {
            await sendMessage(env, subscriber.chat_id, formatCard(event, kind), notificationMenu(event));
            await env.DB.prepare(
              "INSERT OR IGNORE INTO notification_deliveries (publication_id, chat_id) VALUES (?, ?)",
            ).bind(publicationId, subscriber.chat_id).run();
          } catch (error) {
            if (error instanceof TelegramApiError && (error.status === 403 || /blocked|chat not found/i.test(error.message))) {
              await env.DB.prepare(
                "UPDATE subscribers SET active = 0, unsubscribed_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
              ).bind(subscriber.chat_id).run();
              continue;
            }
            failures.push(String(error).slice(0, 300));
          }
        }
        if (failures.length) {
          await env.DB.prepare(
            "UPDATE published_versions SET status = 'failed', error = ? WHERE publication_id = ?",
          ).bind(failures.join(" | ").slice(0, 500), publicationId).run();
          throw new Error(`Notification delivery failed for ${failures.length} subscriber(s)`);
        }
        await env.DB.prepare(
          "UPDATE published_versions SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL WHERE publication_id = ?",
        ).bind(publicationId).run();
        published += 1;
      }
    }
    stateUpdates.push(env.DB.prepare(
      `INSERT INTO event_state (event_id, significant_fingerprint)
       VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET
         significant_fingerprint = excluded.significant_fingerprint,
         last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
    ).bind(event.id, fingerprint));
  }
  await env.DB.prepare(
    "UPDATE event_state SET removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP)",
  ).run();
  await runBatches(env, stateUpdates);
  await env.DB.prepare(
    "INSERT INTO sync_runs (mode, event_count, new_count, updated_count, published_count) VALUES (?, ?, ?, ?, ?)",
  ).bind(mode, registry.events.length, newCount, updatedCount, published).run();
  return { events: registry.events.length, new: newCount, updated: updatedCount, published };
}
