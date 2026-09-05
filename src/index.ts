import { timingSafeEqual } from "node:crypto";
import { loadEvents } from "./github";
import { sync } from "./sync";
import { handleUpdate } from "./telegram";
import type { TelegramUpdate } from "./types";

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ ok: true, service: "russia-india-events-bot", ai: false, parsing: false });
      }
      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!(await safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET))) return json({ ok: false }, 401);
        const update = await request.json() as TelegramUpdate;
        if (!Number.isSafeInteger(update.update_id)) return json({ ok: false }, 400);
        const claimed = await env.DB.prepare(
          "INSERT OR IGNORE INTO telegram_updates (update_id) VALUES (?)",
        ).bind(update.update_id).run();
        if ((claimed.meta.changes ?? 0) === 0) return json({ ok: true, duplicate: true });
        ctx.waitUntil((async () => {
          try {
            const registry = await loadEvents(env);
            await handleUpdate(env, update, registry.events);
          } catch (error) {
            console.error(JSON.stringify({ event: "telegram_update_failed", update_id: update.update_id, error: String(error) }));
          }
        })());
        return json({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/sync") {
        const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (!(await safeEqual(supplied, env.SYNC_SECRET))) return json({ ok: false }, 401);
        const body = await request.json() as { mode?: "bootstrap" | "monitor" };
        return json({ ok: true, ...(await sync(env, body.mode === "bootstrap" ? "bootstrap" : "monitor")) });
      }
      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", error: String(error) }));
      return json({ ok: false, error: "internal error" }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await sync(env, "scheduled");
  },
};
