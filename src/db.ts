import { computeCollectorHealth } from "./core/epistemics";
import { decideAnalysisGate, type AnalysisGateInput } from "./core/analysisGate";
import type {
  AlertInput,
  ClaimInput,
  CollectorMessage,
  CollectorName,
  Env,
  EventInput,
  EvidenceInput,
  OfficialFeedConfig
} from "./types";
import { dayKey, nowIso, parseNumber, sha256, stableId } from "./utils";

export interface InsertOutcome {
  id: string;
  inserted: boolean;
}

export interface QueueDepths {
  cloudflare: "configured" | "not_configured";
  d1Fallback: Record<string, number>;
  analysis: Record<string, number>;
}

export async function ensureDefaults(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO sources
       (id, name, type, organization, language, official_status, default_interest_level,
        default_proximity, default_verifiability, collection_method, priority, expected_interval_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("usgs_earthquake", "USGS Earthquake Hazards Program", "agency", "USGS", "en", "official_primary", 1, 1, 3, "geojson", 10, 15),
    env.DB.prepare(
      `INSERT OR IGNORE INTO sources
       (id, name, type, organization, language, official_status, default_interest_level,
        default_proximity, default_verifiability, collection_method, priority, expected_interval_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("gdacs", "GDACS", "official_aggregator", "UN OCHA / European Commission", "en", "official_aggregator", 1, 2, 2, "rss", 10, 15),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source_endpoints
       (id, source_id, endpoint_type, url, parser, poll_interval, health_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind("endpoint:usgs", "usgs_earthquake", "geojson", env.USGS_FEED_URL ?? defaultUsgsFeed, "usgs_geojson", 15, "UNKNOWN"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source_endpoints
       (id, source_id, endpoint_type, url, parser, poll_interval, health_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind("endpoint:gdacs", "gdacs", "rss", env.GDACS_FEED_URL ?? defaultGdacsFeed, "gdacs_rss", 15, "UNKNOWN"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO collector_jobs (id, collector, enabled, priority, interval_min, next_run_at, config_json)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)`
    ).bind("collector:usgs", "usgs", 10, 15, "{}"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO collector_jobs (id, collector, enabled, priority, interval_min, next_run_at, config_json)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)`
    ).bind("collector:gdacs", "gdacs", 10, 15, "{}"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO collector_jobs (id, collector, enabled, priority, interval_min, next_run_at, config_json)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)`
    ).bind("collector:official_rss", "official_rss", 50, 60, env.OFFICIAL_RSS_FEEDS ?? "[]")
  ]);

  for (const feed of parseOfficialFeeds(env)) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO sources
         (id, name, type, language, official_status, default_interest_level, default_proximity,
          default_verifiability, collection_method, priority, expected_interval_min)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(feedSourceId(feed), feed.name, "official_feed", feed.language ?? "unknown", "official_statement_source", 2, 2, 2, "rss", feed.priority ?? 50, feed.pollInterval ?? 60),
      env.DB.prepare(
        `INSERT OR IGNORE INTO source_endpoints
         (id, source_id, endpoint_type, url, parser, poll_interval, health_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(`endpoint:official_rss:${feed.id}`, feedSourceId(feed), "rss", feed.url, "generic_rss_atom", feed.pollInterval ?? 60, "UNKNOWN")
    ]);
  }
}

export async function insertEvidence(env: Env, input: EvidenceInput): Promise<InsertOutcome> {
  const contentHash = input.contentHash ?? await sha256(JSON.stringify(input.normalized) + (input.rawText ?? ""));
  const id = input.id ?? stableId("ev", `${input.sourceId}:${input.externalId ?? contentHash}`);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO evidence
     (id, source_id, external_id, canonical_url, original_url, published_at, content_hash,
      origin_group, media_type, language, verification_status, raw_text, normalized_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    input.sourceId,
    input.externalId ?? null,
    input.canonicalUrl ?? null,
    input.originalUrl ?? null,
    input.publishedAt ?? null,
    contentHash,
    input.originGroup ?? input.sourceId,
    input.mediaType ?? "text",
    input.language ?? null,
    input.verificationStatus ?? "UNVERIFIED",
    input.rawText ?? null,
    JSON.stringify(input.normalized)
  ).run();

  return { id, inserted: (result.meta?.changes ?? 0) > 0 };
}

export async function upsertEvent(env: Env, event: EventInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events
     (id, name, event_type, region, domain, status, started_at, impact, urgency,
      event_confidence, assessment_confidence, source_quality, independent_streams, last_update)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      event_type = excluded.event_type,
      region = excluded.region,
      domain = excluded.domain,
      status = excluded.status,
      impact = MAX(events.impact, excluded.impact),
      urgency = MAX(events.urgency, excluded.urgency),
      event_confidence = excluded.event_confidence,
      assessment_confidence = excluded.assessment_confidence,
      source_quality = excluded.source_quality,
      independent_streams = MAX(events.independent_streams, excluded.independent_streams),
      last_update = CURRENT_TIMESTAMP`
  ).bind(
    event.id,
    event.name,
    event.eventType,
    event.region ?? null,
    event.domain,
    event.status,
    event.startedAt ?? null,
    event.impact,
    event.urgency,
    event.eventConfidence,
    event.assessmentConfidence,
    event.sourceQuality,
    event.independentStreams
  ).run();
}

export async function insertClaim(env: Env, claim: ClaimInput, evidenceId: string, gate?: AnalysisGateInput): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO claims
     (id, claim_text, epistemic_tag, event_id, region, domain, p_score, i_score, v_score,
      evidence_rank, event_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    claim.id,
    claim.text,
    claim.epistemicTag,
    claim.eventId ?? null,
    claim.region ?? null,
    claim.domain ?? null,
    claim.pScore,
    claim.iScore,
    claim.vScore,
    claim.evidenceRank,
    claim.eventConfidence
  ).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO claim_evidence
     (claim_id, evidence_id, relationship, independent_stream, supports, origin_group)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(claim.id, evidenceId, "source_statement", claim.evidenceRank, 1, claim.evidenceRank).run();

  const decision = decideAnalysisGate(gate ?? {
    collector: "manual",
    domain: claim.domain,
    region: claim.region,
    eventConfidence: claim.eventConfidence,
    novelty: "NEW"
  });
  await env.DB.prepare(
    `INSERT OR IGNORE INTO analysis_gate_decisions
     (id, claim_id, evidence_id, decision, score, reason_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    stableId("gate", `${claim.id}:${evidenceId}`),
    claim.id,
    evidenceId,
    decision.shouldQueue ? "QUEUE" : "SKIP",
    decision.score,
    JSON.stringify(decision.reasons)
  ).run();

  if (decision.shouldQueue) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO analysis_queue
       (id, object_type, object_id, analysis_level, priority, reason, gate_status, gate_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      stableId("analysis", claim.id),
      "claim",
      claim.id,
      "LIGHT",
      decision.score >= 1 ? 20 : 40,
      "Deterministic materiality gate selected this candidate claim",
      "GATED",
      JSON.stringify(decision.reasons)
    ).run();
  }
}

export async function upsertAlert(env: Env, alert: AlertInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alerts
     (id, alert_level, event_id, scenario_id, title, reason, event_confidence, assessment_confidence,
      issued_at, notification_eligible_at, audit_class, audit_note, operational_metric)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      alert_level = excluded.alert_level,
      title = excluded.title,
      reason = excluded.reason,
      event_confidence = excluded.event_confidence,
      assessment_confidence = excluded.assessment_confidence,
      audit_class = COALESCE(alerts.audit_class, excluded.audit_class),
      audit_note = COALESCE(alerts.audit_note, excluded.audit_note),
      status = 'ACTIVE'`
  ).bind(
    alert.id,
    alert.level,
    alert.eventId ?? null,
    alert.scenarioId ?? null,
    alert.title,
    alert.reason,
    alert.eventConfidence,
    alert.assessmentConfidence,
    nowIso(),
    alert.notificationEligibleAt === undefined ? nowIso() : alert.notificationEligibleAt,
    alert.auditClass ?? null,
    alert.auditNote ?? null,
    alert.operationalMetric === false ? 0 : 1
  ).run();
}

export async function recordCollectorSuccess(env: Env, collector: CollectorName, intervalMinutes: number, itemsFound: number, itemsNew: number, itemsFailed: number, runId: string): Promise<void> {
  const now = nowIso();
  const assessment = computeCollectorHealth({
    now: new Date(now),
    lastSuccess: now,
    expectedIntervalMinutes: intervalMinutes,
    consecutiveFailures: itemsFailed > 0 ? 1 : 0
  });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE collection_runs
       SET finished_at = ?, items_found = ?, items_new = ?, items_failed = ?, api_status = ?
       WHERE id = ?`
    ).bind(now, itemsFound, itemsNew, itemsFailed, itemsFailed > 0 ? "PARTIAL" : "OK", runId),
    env.DB.prepare(
      `INSERT INTO collector_health
       (collector, last_success, expected_interval, consecutive_failures, data_gap_minutes, health, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(collector) DO UPDATE SET
        last_success = excluded.last_success,
        expected_interval = excluded.expected_interval,
        consecutive_failures = excluded.consecutive_failures,
        data_gap_minutes = excluded.data_gap_minutes,
        health = excluded.health,
        updated_at = excluded.updated_at`
    ).bind(collector, now, intervalMinutes, itemsFailed > 0 ? 1 : 0, assessment.dataGapMinutes, assessment.health, now)
  ]);
}

export async function recordCollectorFailure(env: Env, collector: CollectorName, intervalMinutes: number, runId: string, error: unknown): Promise<void> {
  const now = nowIso();
  const current = await env.DB.prepare("SELECT last_success, consecutive_failures FROM collector_health WHERE collector = ?").bind(collector).first<{ last_success: string | null; consecutive_failures: number | null }>();
  const failures = (current?.consecutive_failures ?? 0) + 1;
  const assessment = computeCollectorHealth({
    now: new Date(now),
    lastSuccess: current?.last_success,
    expectedIntervalMinutes: intervalMinutes,
    consecutiveFailures: failures
  });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE collection_runs SET finished_at = ?, items_failed = 1, api_status = ?, error = ? WHERE id = ?`
    ).bind(now, "ERROR", String(error instanceof Error ? error.message : error), runId),
    env.DB.prepare(
      `INSERT INTO collector_health
       (collector, last_success, expected_interval, consecutive_failures, data_gap_minutes, health, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(collector) DO UPDATE SET
        expected_interval = excluded.expected_interval,
        consecutive_failures = excluded.consecutive_failures,
        data_gap_minutes = excluded.data_gap_minutes,
        health = excluded.health,
        updated_at = excluded.updated_at`
    ).bind(collector, current?.last_success ?? null, intervalMinutes, failures, assessment.dataGapMinutes, assessment.health, now)
  ]);
}

export async function startCollectionRun(env: Env, collector: CollectorName): Promise<string> {
  const id = stableId("run", `${collector}:${crypto.randomUUID()}`);
  await env.DB.prepare(
    `INSERT INTO collection_runs (id, collector, started_at, api_status)
     VALUES (?, ?, ?, ?)`
  ).bind(id, collector, nowIso(), "RUNNING").run();
  return id;
}

export async function scheduleNextRun(env: Env, jobId: string, intervalMinutes: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE collector_jobs
     SET next_run_at = datetime('now', ? || ' minutes')
     WHERE id = ?`
  ).bind(String(intervalMinutes), jobId).run();
}

export async function enqueueCollector(env: Env, message: CollectorMessage, priority = 50): Promise<"cloudflare_queue" | "d1_fallback"> {
  if (env.COLLECT_QUEUE) {
    await env.COLLECT_QUEUE.send(message);
    return "cloudflare_queue";
  }
  await env.DB.prepare(
    `INSERT INTO job_queue (id, queue_name, payload_json, priority, available_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(stableId("job", crypto.randomUUID()), "collect", JSON.stringify(message), priority, nowIso()).run();
  return "d1_fallback";
}

export async function takeFallbackCollectorJobs(env: Env, limit: number): Promise<Array<{ id: string; message: CollectorMessage }>> {
  const rows = await env.DB.prepare(
    `SELECT id, payload_json
     FROM job_queue
     WHERE queue_name = 'collect' AND status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP
     ORDER BY priority ASC, created_at ASC
     LIMIT ?`
  ).bind(limit).all<{ id: string; payload_json: string }>();
  const jobs = rows.results.map((row) => ({ id: row.id, message: JSON.parse(row.payload_json) as CollectorMessage }));
  for (const job of jobs) {
    await env.DB.prepare("UPDATE job_queue SET status = 'RUNNING', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id).run();
  }
  return jobs;
}

export async function finishFallbackJob(env: Env, id: string, error?: unknown): Promise<void> {
  if (error) {
    await env.DB.prepare(
      `UPDATE job_queue
       SET status = CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
           available_at = datetime('now', '+15 minutes'),
           last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(String(error instanceof Error ? error.message : error), id).run();
    return;
  }
  await env.DB.prepare("UPDATE job_queue SET status = 'DONE', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
}

export async function recordSystemState(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, typeof value === "string" ? value : JSON.stringify(value)).run();
}

export async function incrementAccounting(env: Env, kind: string, amount = 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO request_accounting (day, kind, count, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(day, kind) DO UPDATE SET count = count + excluded.count, updated_at = CURRENT_TIMESTAMP`
  ).bind(dayKey(), kind, amount).run();
}

export async function budgetState(env: Env): Promise<{ mode: "NORMAL" | "DEGRADED"; collectorRunsToday: number; softLimit: number }> {
  const row = await env.DB.prepare("SELECT count FROM request_accounting WHERE day = ? AND kind = 'collector_run'").bind(dayKey()).first<{ count: number }>();
  const collectorRunsToday = row?.count ?? 0;
  const softLimit = parseNumber(env.FREE_TIER_DAILY_COLLECTOR_RUN_SOFT_LIMIT, 250);
  return {
    mode: collectorRunsToday >= softLimit ? "DEGRADED" : "NORMAL",
    collectorRunsToday,
    softLimit
  };
}

export async function aiBudgetState(env: Env): Promise<{ enabled: boolean; modelConfigured: boolean; model: string | null; requestsToday: number; requestSoftLimit: number; estimatedUnitsToday: number; unitSoftLimit: number; mode: "DISABLED" | "NORMAL" | "CAPPED" }> {
  const model = env.AI_MODEL?.trim() || null;
  const requestSoftLimit = parseNumber(env.AI_DAILY_REQUEST_SOFT_LIMIT, 100);
  const unitSoftLimit = parseNumber(env.AI_DAILY_ESTIMATED_UNIT_SOFT_LIMIT, 100000);
  const row = model
    ? await env.DB.prepare("SELECT requests, estimated_units FROM ai_budget_usage WHERE day = ? AND model = ?").bind(dayKey(), model).first<{ requests: number; estimated_units: number }>()
    : null;
  const requestsToday = row?.requests ?? 0;
  const estimatedUnitsToday = row?.estimated_units ?? 0;
  const enabled = Boolean(env.AI && model);
  return {
    enabled,
    modelConfigured: Boolean(model),
    model,
    requestsToday,
    requestSoftLimit,
    estimatedUnitsToday,
    unitSoftLimit,
    mode: !enabled ? "DISABLED" : requestsToday >= requestSoftLimit || estimatedUnitsToday >= unitSoftLimit ? "CAPPED" : "NORMAL"
  };
}

export async function queueDepths(env: Env): Promise<QueueDepths> {
  const fallback = await env.DB.prepare("SELECT queue_name, status, COUNT(*) AS count FROM job_queue GROUP BY queue_name, status").all<{ queue_name: string; status: string; count: number }>();
  const analysis = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM analysis_queue GROUP BY status").all<{ status: string; count: number }>();
  return {
    cloudflare: env.COLLECT_QUEUE ? "configured" : "not_configured",
    d1Fallback: Object.fromEntries(fallback.results.map((row) => [`${row.queue_name}:${row.status}`, row.count])),
    analysis: Object.fromEntries(analysis.results.map((row) => [row.status, row.count]))
  };
}

export function parseOfficialFeeds(env: Env): OfficialFeedConfig[] {
  try {
    const parsed = JSON.parse(env.OFFICIAL_RSS_FEEDS ?? "[]") as OfficialFeedConfig[];
    return Array.isArray(parsed) ? parsed.filter((feed) => feed.id && feed.name && feed.url) : [];
  } catch {
    return [];
  }
}

export function feedSourceId(feed: OfficialFeedConfig): string {
  return stableId("official_rss", feed.id);
}

const defaultUsgsFeed = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
const defaultGdacsFeed = "https://www.gdacs.org/xml/rss.xml";
