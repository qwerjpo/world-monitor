export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers
    }
  });
}

export function errorJson(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, { status });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}:${value.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 160)}`;
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? request.headers.get("x-ingest-token") ?? undefined;
}

export function sanitizeMessage(value: string, limit = 3200): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
