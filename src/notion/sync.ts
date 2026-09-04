import type { Env } from "../types";

type ProjectionType = "alert" | "event" | "scenario" | "system_health";
type NotionPropertyType = "title" | "rich_text" | "select" | "status" | "date" | "number" | "checkbox" | "url";

interface ProjectionRecord {
  name: string;
  status: string;
  level: string;
  summary: string;
  timestamp: string;
  objectId: string;
  objectType: ProjectionType;
}

interface NotionProperty {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface NotionSchema {
  id: string;
  properties: Record<string, NotionProperty>;
}

interface PropertyMapping {
  title?: string;
  status?: string;
  level?: string;
  summary?: string;
  timestamp?: string;
  objectId?: string;
  objectType?: string;
}

export async function syncImportantNotionProjections(env: Env): Promise<{ configured: boolean; attempted: number; synced: number; errors: number }> {
  if (!env.NOTION_TOKEN) return { configured: false, attempted: 0, synced: 0, errors: 0 };
  const targets = notionTargets(env);
  let attempted = 0;
  let synced = 0;
  let errors = 0;

  const alerts = await env.DB.prepare(
    `SELECT id, alert_level, title, reason, status, issued_at
     FROM alerts
     WHERE alert_level IN ('WARNING', 'CRITICAL')
       AND status = 'ACTIVE'
       AND COALESCE(audit_class, 'REAL') NOT IN ('TEST_GENERATED', 'THRESHOLD_FALSE_POSITIVE', 'STALE/HISTORICAL')
     ORDER BY issued_at DESC
     LIMIT 10`
  ).all<Record<string, unknown>>();
  for (const alert of alerts.results) {
    attempted += 1;
    const ok = await syncRecord(env, "alert", String(alert.id), targets.alert, {
      name: String(alert.title),
      status: String(alert.status),
      level: String(alert.alert_level),
      summary: String(alert.reason ?? ""),
      timestamp: String(alert.issued_at),
      objectId: String(alert.id),
      objectType: "alert"
    });
    ok ? synced += 1 : errors += 1;
  }

  const events = await env.DB.prepare(
    `SELECT id, name, status, domain, region, last_update
     FROM events
     WHERE impact >= 0.7 OR status = 'TRACKING'
     ORDER BY last_update DESC
     LIMIT 10`
  ).all<Record<string, unknown>>();
  for (const event of events.results) {
    attempted += 1;
    const ok = await syncRecord(env, "event", String(event.id), targets.event, {
      name: String(event.name),
      status: String(event.status),
      level: String(event.domain),
      summary: String(event.region ?? ""),
      timestamp: String(event.last_update),
      objectId: String(event.id),
      objectType: "event"
    });
    ok ? synced += 1 : errors += 1;
  }

  const healthRows = await env.DB.prepare(
    `SELECT collector AS id, collector AS name, health AS status, data_gap_minutes, updated_at
     FROM collector_health
     WHERE health IN ('YELLOW', 'ORANGE', 'RED', 'UNKNOWN')
     ORDER BY updated_at DESC`
  ).all<Record<string, unknown>>();
  for (const health of healthRows.results) {
    attempted += 1;
    const ok = await syncRecord(env, "system_health", String(health.id), targets.system_health, {
      name: `Collector ${String(health.name)}`,
      status: String(health.status),
      level: "collector",
      summary: `Data gap minutes: ${String(health.data_gap_minutes ?? "UNKNOWN")}`,
      timestamp: String(health.updated_at),
      objectId: String(health.id),
      objectType: "system_health"
    });
    ok ? synced += 1 : errors += 1;
  }

  return { configured: true, attempted, synced, errors };
}

export async function retrieveNotionSchemaReport(env: Env): Promise<{ configured: boolean; schemas: Array<{ type: ProjectionType; dataSourceId: string; mapping: PropertyMapping; properties: Array<{ name: string; type: string }> }>; errors: Array<{ type: ProjectionType; dataSourceId?: string; error: string }> }> {
  if (!env.NOTION_TOKEN) return { configured: false, schemas: [], errors: [] };
  const schemas = [];
  const errors = [];
  for (const [type, dataSourceId] of Object.entries(notionTargets(env)) as Array<[ProjectionType, string | undefined]>) {
    if (!dataSourceId) {
      errors.push({ type, error: "missing data source id" });
      continue;
    }
    try {
      const schema = await retrieveDataSource(env, dataSourceId);
      const mapping = buildPropertyMapping(schema);
      await cacheSchema(env, dataSourceId, type, schema, mapping);
      schemas.push({
        type,
        dataSourceId,
        mapping,
        properties: Object.values(schema.properties).map((property) => ({ name: property.name, type: property.type }))
      });
    } catch (error) {
      errors.push({ type, dataSourceId, error: String(error instanceof Error ? error.message : error) });
    }
  }
  return { configured: true, schemas, errors };
}

async function syncRecord(
  env: Env,
  type: ProjectionType,
  objectId: string,
  dataSourceId: string | undefined,
  record: ProjectionRecord
): Promise<boolean> {
  if (!dataSourceId || !env.NOTION_TOKEN) return false;
  const schema = await getCachedOrRemoteSchema(env, dataSourceId, type);
  const mapping = buildPropertyMapping(schema);
  if (!mapping.title) {
    await recordNotionStatus(env, type, objectId, "ERROR missing title property");
    return false;
  }

  const existing = await env.DB.prepare("SELECT notion_page_id FROM notion_map WHERE object_type = ? AND object_id = ?").bind(type, objectId).first<{ notion_page_id: string }>();
  const properties = buildProperties(schema, mapping, record);
  const headers = notionHeaders(env);

  let response: Response;
  if (existing?.notion_page_id) {
    response = await fetch(`https://api.notion.com/v1/pages/${existing.notion_page_id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ properties })
    });
  } else {
    response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties
      })
    });
  }

  if (!response.ok) {
    await recordNotionStatus(env, type, objectId, `ERROR ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return false;
  }

  const data = await response.json<{ id: string }>();
  await env.DB.prepare(
    `INSERT INTO notion_map (object_type, object_id, notion_page_id, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(object_type, object_id) DO UPDATE SET notion_page_id = excluded.notion_page_id, updated_at = CURRENT_TIMESTAMP`
  ).bind(type, objectId, data.id).run();
  await recordNotionStatus(env, type, objectId, "OK");
  return true;
}

async function getCachedOrRemoteSchema(env: Env, dataSourceId: string, type: ProjectionType): Promise<NotionSchema> {
  const cached = await env.DB.prepare("SELECT schema_json FROM notion_schema_cache WHERE data_source_id = ?").bind(dataSourceId).first<{ schema_json: string }>();
  if (cached) return JSON.parse(cached.schema_json) as NotionSchema;
  const schema = await retrieveDataSource(env, dataSourceId);
  await cacheSchema(env, dataSourceId, type, schema, buildPropertyMapping(schema));
  return schema;
}

async function retrieveDataSource(env: Env, dataSourceId: string): Promise<NotionSchema> {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, {
    headers: notionHeaders(env)
  });
  if (!response.ok) throw new Error(`Notion data source ${dataSourceId} returned ${response.status}`);
  return response.json<NotionSchema>();
}

async function cacheSchema(env: Env, dataSourceId: string, type: ProjectionType, schema: NotionSchema, mapping: PropertyMapping): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notion_schema_cache (data_source_id, object_type, schema_json, mapping_json, retrieved_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(data_source_id) DO UPDATE SET
       object_type = excluded.object_type,
       schema_json = excluded.schema_json,
       mapping_json = excluded.mapping_json,
       retrieved_at = CURRENT_TIMESTAMP`
  ).bind(dataSourceId, type, JSON.stringify(schema), JSON.stringify(mapping)).run();
}

export function buildPropertyMapping(schema: NotionSchema): PropertyMapping {
  const properties = Object.values(schema.properties);
  return {
    title: findProperty(properties, ["title"], [/^(name|title|alert|event|scenario|source)$/i]),
    status: findProperty(properties, ["status", "select", "rich_text"], [/status|state|health|class/i]),
    level: findProperty(properties, ["select", "status", "rich_text"], [/level|severity|priority|domain|type/i]),
    summary: findProperty(properties, ["rich_text", "title"], [/summary|reason|note|description|trigger/i]),
    timestamp: findProperty(properties, ["date"], [/updated|issued|time|date|observed/i]),
    objectId: findProperty(properties, ["rich_text", "url"], [/object.*id|record.*id|source.*id|d1.*id|external.*id/i]),
    objectType: findProperty(properties, ["select", "rich_text"], [/object.*type|record.*type|kind/i])
  };
}

function buildProperties(schema: NotionSchema, mapping: PropertyMapping, record: ProjectionRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  setMapped(out, schema, mapping.title, record.name);
  setMapped(out, schema, mapping.status, record.status);
  setMapped(out, schema, mapping.level, record.level);
  setMapped(out, schema, mapping.summary, record.summary);
  setMapped(out, schema, mapping.timestamp, record.timestamp);
  setMapped(out, schema, mapping.objectId, record.objectId);
  setMapped(out, schema, mapping.objectType, record.objectType);
  return out;
}

function setMapped(out: Record<string, unknown>, schema: NotionSchema, propertyName: string | undefined, value: string): void {
  if (!propertyName) return;
  const property = schema.properties[propertyName];
  const built = buildPropertyValue(property.type as NotionPropertyType, value);
  if (built) out[propertyName] = built;
}

function buildPropertyValue(type: NotionPropertyType, value: string): unknown {
  const clean = value.slice(0, 1800);
  switch (type) {
    case "title":
      return { title: [{ text: { content: clean.slice(0, 180) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: clean } }] };
    case "select":
      return { select: { name: clean.slice(0, 100) } };
    case "status":
      return { status: { name: clean.slice(0, 100) } };
    case "date":
      return { date: { start: normalizeDate(clean) } };
    case "number": {
      const number = Number(clean);
      return Number.isFinite(number) ? { number } : undefined;
    }
    case "checkbox":
      return { checkbox: ["true", "yes", "1", "active", "critical", "warning"].includes(clean.toLowerCase()) };
    case "url":
      return clean.startsWith("http") ? { url: clean } : undefined;
  }
}

function findProperty(properties: NotionProperty[], preferredTypes: string[], namePatterns: RegExp[]): string | undefined {
  for (const type of preferredTypes) {
    const candidates = properties.filter((property) => property.type === type);
    for (const pattern of namePatterns) {
      const found = candidates.find((property) => pattern.test(property.name));
      if (found) return found.name;
    }
    if (type === "title" && candidates[0]) return candidates[0].name;
  }
  return undefined;
}

async function recordNotionStatus(env: Env, type: string, objectId: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(`notion:${type}:${objectId}`, status).run();
}

function notionTargets(env: Env): Record<ProjectionType, string | undefined> {
  return {
    alert: env.NOTION_ALERTS_DATA_SOURCE_ID,
    event: env.NOTION_EVENTS_DATA_SOURCE_ID,
    scenario: env.NOTION_SCENARIOS_DATA_SOURCE_ID,
    system_health: env.NOTION_SYSTEM_HEALTH_DATA_SOURCE_ID
  };
}

function notionHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.NOTION_TOKEN}`,
    "content-type": "application/json",
    "notion-version": "2026-03-11"
  };
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
