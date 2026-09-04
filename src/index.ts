import { notifyPendingTelegramAlerts } from "./alerts/telegram";
import { aiBudgetState, insertClaim, insertEvidence, ensureDefaults, queueDepths, recordSystemState, upsertAlert, upsertEvent } from "./db";
import { retrieveNotionSchemaReport } from "./notion/sync";
import { runCollector, runScheduler } from "./scheduler";
import type { AlertInput, ClaimInput, CollectorMessage, Env, EventInput } from "./types";
import { bearerToken, errorJson, json, nowIso, readJson, sha256, stableId } from "./utils";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return cors(json({ ok: true }));
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname.startsWith("/ingest/") || url.pathname.startsWith("/admin/")) {
        const response = await routeApi(request, env, ctx, url);
        return cors(response);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return fallbackDashboard();
    } catch (error) {
      return cors(errorJson(500, "Unhandled worker error", { detail: String(error instanceof Error ? error.message : error) }));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduler(env));
  },

  async queue(batch: MessageBatch<CollectorMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await runCollector(env, message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, CollectorMessage>;

async function routeApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/health") return health(env);
  if (request.method === "GET" && url.pathname === "/api/alerts") return list(env, "alerts", "issued_at DESC", 100);
  if (request.method === "GET" && url.pathname === "/api/events") return list(env, "events", "last_update DESC", 100);
  if (request.method === "GET" && url.pathname === "/api/scenarios") return list(env, "scenarios", "last_updated DESC", 100);
  if (request.method === "GET" && url.pathname === "/api/system-health") return systemHealth(env);
  if (request.method === "GET" && url.pathname === "/api/alert-audit") return alertAudit(env);
  if (request.method === "POST" && url.pathname === "/ingest/manual") return ingestManual(request, env, ctx);
  if (request.method === "POST" && url.pathname === "/ingest/telegram") return ingestTelegram(request, env, ctx);
  if (request.method === "POST" && url.pathname === "/admin/run-scheduler") return adminRunScheduler(request, env);
  if (request.method === "POST" && url.pathname === "/admin/run-collector") return adminRunCollector(request, env);
  if (request.method === "POST" && url.pathname === "/admin/notion/schema-report") return adminNotionSchemaReport(request, env);
  return errorJson(404, "Route not found");
}

async function health(env: Env): Promise<Response> {
  await ensureDefaults(env);
  let d1Reachable = false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    d1Reachable = true;
  } catch {
    d1Reachable = false;
  }

  const collectors = await env.DB.prepare(
    `SELECT collector, last_success, expected_interval, consecutive_failures, data_gap_minutes, health, updated_at
     FROM collector_health
     ORDER BY collector`
  ).all<Record<string, unknown>>();
  const state = await env.DB.prepare("SELECT key, value, updated_at FROM system_state ORDER BY key").all<Record<string, string>>();
  const stateObject = Object.fromEntries(state.results.map((row) => [row.key, parseStateValue(row.value)]));
  const [queues, aiBudget] = await Promise.all([queueDepths(env), aiBudgetState(env)]);

  return json({
    ok: d1Reachable,
    service: "reachable",
    d1: d1Reachable ? "reachable" : "unreachable",
    scheduler: {
      lastRun: stateObject.last_scheduler_run ?? null,
      cron: "*/15 * * * *"
    },
    collectors: collectors.results,
    queues,
    ai: aiBudget,
    notion: {
      configured: Boolean(env.NOTION_TOKEN),
      lastProjection: stateObject.notion_projection ?? null
    },
    notification: {
      telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      readiness: notificationReadiness(env),
      enableAfter: env.NOTIFICATION_ENABLE_AFTER || null,
      lastAlertRun: stateObject.telegram_alerts ?? null
    },
    budget: stateObject.budget ?? { mode: "UNKNOWN" }
  });
}

async function alertAudit(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.alert_level, a.title, a.issued_at, a.notification_eligible_at,
            a.audit_class, a.audit_note, aa.trigger_summary, aa.proposed_threshold_correction
     FROM alerts a
     LEFT JOIN alert_audit aa ON aa.alert_id = a.id
     WHERE a.alert_level IN ('WARNING', 'CRITICAL')
     ORDER BY a.issued_at ASC`
  ).all<Record<string, unknown>>();
  return json({ ok: true, items: rows.results });
}

async function systemHealth(env: Env): Promise<Response> {
  await ensureDefaults(env);
  const collectors = await env.DB.prepare(
    `SELECT collector, health, last_success, data_gap_minutes, consecutive_failures, updated_at
     FROM collector_health
     ORDER BY
       CASE health WHEN 'RED' THEN 1 WHEN 'ORANGE' THEN 2 WHEN 'YELLOW' THEN 3 WHEN 'UNKNOWN' THEN 4 ELSE 5 END,
       collector`
  ).all<Record<string, unknown>>();
  const state = await env.DB.prepare("SELECT key, value, updated_at FROM system_state ORDER BY updated_at DESC").all<Record<string, unknown>>();
  return json({ ok: true, collectors: collectors.results, state: state.results });
}

async function list(env: Env, table: "alerts" | "events" | "scenarios", order: string, limit: number): Promise<Response> {
  await ensureDefaults(env);
  const rows = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order} LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  return json({ ok: true, items: rows.results });
}

async function ingestManual(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = requireIngestAuth(request, env);
  if (auth) return auth;
  const body = await readJson<{
    sourceId?: string;
    sourceName?: string;
    externalId?: string;
    title?: string;
    rawText?: string;
    canonicalUrl?: string;
    publishedAt?: string;
    normalized?: Record<string, unknown>;
    event?: Partial<EventInput>;
    alert?: Partial<AlertInput>;
  }>(request);

  const sourceId = body.sourceId ?? "manual";
  await ensureManualSource(env, sourceId, body.sourceName ?? "Manual ingest");
  const normalized = {
    source: sourceId,
    semantics: "manual_ingest_statement",
    warning: "manual ingestion is tracked as a statement until separately evaluated",
    title: body.title ?? "Manual ingest",
    ...(body.normalized ?? {})
  };
  const evidence = await insertEvidence(env, {
    sourceId,
    externalId: body.externalId ?? crypto.randomUUID(),
    canonicalUrl: body.canonicalUrl,
    originalUrl: body.canonicalUrl,
    publishedAt: body.publishedAt ?? nowIso(),
    contentHash: await sha256(JSON.stringify(normalized) + (body.rawText ?? "")),
    originGroup: `${sourceId}:${body.externalId ?? "manual"}`,
    mediaType: "manual",
    rawText: body.rawText ?? body.title ?? "Manual ingest",
    normalized
  });

  const eventId = body.event?.id;
  if (eventId && body.event?.name && body.event?.eventType && body.event?.domain) {
    await upsertEvent(env, {
      id: eventId,
      name: body.event.name,
      eventType: body.event.eventType,
      region: body.event.region,
      domain: body.event.domain,
      status: body.event.status ?? "UNCONFIRMED",
      startedAt: body.event.startedAt,
      impact: body.event.impact ?? 0.3,
      urgency: body.event.urgency ?? 0.3,
      eventConfidence: body.event.eventConfidence ?? 0.35,
      assessmentConfidence: body.event.assessmentConfidence ?? 0.35,
      sourceQuality: body.event.sourceQuality ?? 0.4,
      independentStreams: body.event.independentStreams ?? 1
    });
  }

  await insertClaim(env, manualClaim(body.title ?? body.rawText ?? "Manual ingest item", sourceId, evidence.id, eventId), evidence.id, {
    collector: "manual",
    domain: body.event?.domain ?? "manual_ingest",
    region: body.event?.region,
    impact: body.event?.impact,
    urgency: body.event?.urgency,
    eventConfidence: body.event?.eventConfidence,
    alertLevel: body.alert?.level,
    novelty: evidence.inserted ? "NEW" : "DUPLICATE",
    highImpactLowConfidence: (body.event?.impact ?? 0) >= 0.85 && (body.event?.eventConfidence ?? 1) < 0.5
  });

  if (body.alert?.id && body.alert.level && body.alert.title) {
    await upsertAlert(env, {
      id: body.alert.id,
      level: body.alert.level,
      eventId: body.alert.eventId ?? eventId,
      scenarioId: body.alert.scenarioId,
      title: body.alert.title,
      reason: body.alert.reason ?? "Manual alert",
      eventConfidence: body.alert.eventConfidence ?? 0.35,
      assessmentConfidence: body.alert.assessmentConfidence ?? 0.35
    });
    ctx.waitUntil(notifyPendingTelegramAlerts(env));
  }

  return json({ ok: true, evidence });
}

async function ingestTelegram(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const auth = requireIngestAuth(request, env);
  if (auth) return auth;
  const body = await readJson<{
    messages?: TelegramIngestMessage[];
  } & Partial<TelegramIngestMessage>>(request);
  const messages = body.messages ?? (body.message_id || body.text ? [body as TelegramIngestMessage] : []);
  let inserted = 0;

  for (const message of messages) {
    const channelId = String(message.channel_id ?? "unknown_channel");
    const sourceId = stableId("telegram", channelId);
    await ensureManualSource(env, sourceId, `Telegram ${channelId}`, "telegram_channel");
    const externalId = `${channelId}:${message.message_id}`;
    const normalized = {
      source: "telegram",
      semantics: "channel_message_statement",
      warning: "Telegram messages are source statements; forwards and repost lineage must not be counted as independent streams",
      channelId,
      messageId: message.message_id,
      postedAt: message.date,
      editedAt: message.edit_date,
      forward: message.forward ?? null,
      permalink: message.permalink,
      media: message.media ?? null
    };
    const evidence = await insertEvidence(env, {
      sourceId,
      externalId,
      canonicalUrl: message.permalink,
      originalUrl: message.permalink,
      publishedAt: message.date,
      contentHash: await sha256(JSON.stringify(normalized) + (message.text ?? "")),
      originGroup: message.forward?.from_channel_id ? `telegram-forward:${message.forward.from_channel_id}:${message.forward.message_id ?? ""}` : `telegram:${externalId}`,
      mediaType: "telegram_message",
      language: message.language,
      rawText: message.text,
      normalized
    });
    if (evidence.inserted) {
      inserted += 1;
      await insertClaim(env, {
        id: stableId("claim:telegram", externalId),
        text: `Telegram channel ${channelId} posted: ${(message.text ?? "").slice(0, 220)}`,
        epistemicTag: "STATEMENT_FACT",
        domain: "telegram_osint",
        pScore: 3,
        iScore: 2,
        vScore: 1,
        evidenceRank: evidence.id,
        eventConfidence: 0.25
      }, evidence.id, {
        collector: "telegram",
        domain: "telegram_osint",
        novelty: "NEW",
        highImpactLowConfidence: false
      });
    }
  }

  return json({ ok: true, received: messages.length, inserted });
}

async function adminRunScheduler(request: Request, env: Env): Promise<Response> {
  const auth = requireIngestAuth(request, env);
  if (auth) return auth;
  const result = await runScheduler(env);
  return json({ ok: true, result });
}

async function adminRunCollector(request: Request, env: Env): Promise<Response> {
  const auth = requireIngestAuth(request, env);
  if (auth) return auth;
  const body = await readJson<{ collector?: CollectorMessage["collector"] }>(request);
  if (!body.collector) return errorJson(400, "collector is required");
  const result = await runCollector(env, { collector: body.collector });
  return json({ ok: true, result });
}

async function adminNotionSchemaReport(request: Request, env: Env): Promise<Response> {
  const auth = requireIngestAuth(request, env);
  if (auth) return auth;
  const report = await retrieveNotionSchemaReport(env);
  return json({ ok: true, report });
}

function requireIngestAuth(request: Request, env: Env): Response | undefined {
  if (!env.INTERNAL_INGEST_TOKEN) return errorJson(503, "INTERNAL_INGEST_TOKEN is not configured");
  if (bearerToken(request) !== env.INTERNAL_INGEST_TOKEN) return errorJson(401, "Invalid ingest token");
  return undefined;
}

async function ensureManualSource(env: Env, sourceId: string, name: string, type = "manual"): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sources
     (id, name, type, official_status, default_interest_level, default_proximity,
      default_verifiability, collection_method, priority, expected_interval_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sourceId, name, type, "unvetted_statement_source", 2, 3, 1, type, 60, 1440).run();
}

function manualClaim(text: string, sourceId: string, evidenceId: string, eventId?: string): ClaimInput {
  return {
    id: stableId("claim:manual", `${sourceId}:${evidenceId}`),
    text,
    epistemicTag: "STATEMENT_FACT",
    eventId,
    domain: "manual_ingest",
    pScore: 3,
    iScore: 2,
    vScore: 1,
    evidenceRank: sourceId,
    eventConfidence: 0.35
  };
}

function parseStateValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function notificationReadiness(env: Env): "READY" | "MISSING_SECRET" {
  return env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? "READY" : "MISSING_SECRET";
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type, x-ingest-token");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function fallbackDashboard(): Response {
  return new Response("WORLD INTELLIGENCE WATCH SYSTEM API is running.", {
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

interface TelegramIngestMessage {
  channel_id: string | number;
  message_id: string | number;
  date?: string;
  edit_date?: string;
  text?: string;
  permalink?: string;
  language?: string;
  media?: Record<string, unknown> | null;
  forward?: {
    from_channel_id?: string | number;
    message_id?: string | number;
    date?: string;
  } | null;
}
