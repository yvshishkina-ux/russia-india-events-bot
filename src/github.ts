import { parseArchiveRegistry, parseEventsRegistry, type ArchiveRegistry, type EventsRegistry } from "./types";

const MAX_BYTES = 3_000_000;

async function githubJson(env: Env, path: string): Promise<unknown> {
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${encodedPath}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const headers = new Headers({
    Accept: "application/vnd.github.raw+json", "User-Agent": "russia-india-events-bot",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (env.GITHUB_TOKEN) headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error(`GitHub ${path}: file too large`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error(`GitHub ${path}: file too large`);
  return JSON.parse(body) as unknown;
}

export async function loadEvents(env: Env): Promise<EventsRegistry> {
  return parseEventsRegistry(await githubJson(env, env.EVENTS_PATH));
}

export async function loadArchive(env: Env): Promise<ArchiveRegistry> {
  return parseArchiveRegistry(await githubJson(env, env.ARCHIVE_PATH));
}
