interface D1Result {
  meta: { changes?: number };
}

interface D1Results<T> {
  results: T[];
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Results<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface ScheduledController {}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  DB: D1Database;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  EVENTS_PATH: string;
  ARCHIVE_PATH: string;
  RECENT_DAYS: string;
  PAGE_SIZE: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SYNC_SECRET: string;
  GITHUB_TOKEN?: string;
}
