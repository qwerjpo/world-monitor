import { labelGdacsAlert } from "../core/epistemics";
import { parseFeed, textValue } from "../core/rss";
import {
  incrementAccounting,
  insertClaim,
  insertEvidence,
  recordCollectorFailure,
  recordCollectorSuccess,
  startCollectionRun,
  upsertAlert,
  upsertEvent
} from "../db";
import type { CollectorResult, Env } from "../types";
import { parseNumber, sanitizeMessage, sha256, stableId } from "../utils";

export async function collectGdacs(env: Env): Promise<CollectorResult> {
  const runId = await startCollectionRun(env, "gdacs");
  const interval = 15;
  try {
    await incrementAccounting(env, "collector_run");
    const url = env.GDACS_FEED_URL ?? "https://www.gdacs.org/xml/rss.xml";
    const response = await fetch(url, { headers: { accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`GDACS feed returned ${response.status}`);

    const xml = await response.text();
    const items = parseFeed(xml).slice(0, parseNumber(env.GDACS_MAX_ITEMS, 40));
    let itemsNew = 0;
    let itemsFailed = 0;

    for (const item of items) {
      try {
        const inserted = await ingestGdacsItem(env, item);
        if (inserted) itemsNew += 1;
      } catch {
        itemsFailed += 1;
      }
    }

    const result = { collector: "gdacs" as const, itemsFound: items.length, itemsNew, itemsFailed };
    await recordCollectorSuccess(env, "gdacs", interval, result.itemsFound, result.itemsNew, result.itemsFailed, runId);
    return result;
  } catch (error) {
    await recordCollectorFailure(env, "gdacs", interval, runId, error);
    throw error;
  }
}

async function ingestGdacsItem(env: Env, item: ReturnType<typeof parseFeed>[number]): Promise<boolean> {
  const raw = item.raw;
  const eventIdRaw = textValue(raw["gdacs:eventid"]) ?? item.id;
  const eventType = textValue(raw["gdacs:eventtype"]) ?? inferType(item.title);
  const country = textValue(raw["gdacs:country"]) ?? textValue(raw["gdacs:countryname"]);
  const alertLevelRaw = textValue(raw["gdacs:alertlevel"]);
  const severity = textValue(raw["gdacs:severity"]);
  const normalized = {
    source: "GDACS",
    semantics: "official_aggregated_disaster_alert_statement",
    warning: "GDACS alert level and severity text are source semantics, not proof of local impact",
    gdacsEventId: eventIdRaw,
    eventType,
    alertLevel: alertLevelRaw ?? "UNKNOWN",
    severity: severity ?? "UNKNOWN",
    country: country ?? "UNKNOWN",
    title: item.title,
    link: item.link,
    publishedAt: item.publishedAt,
    summary: item.summary
  };
  const contentHash = await sha256(JSON.stringify(normalized));
  const evidence = await insertEvidence(env, {
    sourceId: "gdacs",
    externalId: eventIdRaw,
    canonicalUrl: item.link,
    originalUrl: item.link,
    publishedAt: item.publishedAt,
    contentHash,
    originGroup: `gdacs:${eventIdRaw}`,
    mediaType: "rss",
    language: "en",
    verificationStatus: "UNVERIFIED",
    rawText: `${item.title} ${item.summary ?? ""}`.trim(),
    normalized
  });
  if (!evidence.inserted) return false;

  const alertLevel = labelGdacsAlert(alertLevelRaw);
  const eventId = stableId("event:gdacs", eventIdRaw);
  const region = country ?? item.title;
  await upsertEvent(env, {
    id: eventId,
    name: item.title,
    eventType,
    region,
    domain: "disaster",
    status: alertLevel === "INFO" ? "UNCONFIRMED" : "TRACKING",
    startedAt: item.publishedAt,
    impact: alertLevel === "CRITICAL" ? 0.9 : alertLevel === "WARNING" ? 0.7 : 0.35,
    urgency: alertLevel === "CRITICAL" ? 0.9 : alertLevel === "WARNING" ? 0.72 : 0.35,
    eventConfidence: 0.62,
    assessmentConfidence: 0.52,
    sourceQuality: 0.72,
    independentStreams: 1
  });

  await insertClaim(env, {
    id: stableId("claim:gdacs", eventIdRaw),
    text: `GDACS published a ${alertLevelRaw ?? "UNKNOWN"} alert item: ${item.title}.`,
    epistemicTag: "STATEMENT_FACT",
    eventId,
    region,
    domain: "disaster",
    pScore: 2,
    iScore: 1,
    vScore: 2,
    evidenceRank: `gdacs:${eventIdRaw}`,
    eventConfidence: 0.62
  }, evidence.id, {
    collector: "gdacs",
    domain: "disaster",
    eventType,
    region,
    impact: alertLevel === "CRITICAL" ? 0.9 : alertLevel === "WARNING" ? 0.7 : 0.35,
    urgency: alertLevel === "CRITICAL" ? 0.9 : alertLevel === "WARNING" ? 0.72 : 0.35,
    eventConfidence: 0.62,
    alertLevel,
    severityText: severity,
    novelty: evidence.inserted ? "NEW" : "DUPLICATE"
  });

  if (alertLevel === "WARNING" || alertLevel === "CRITICAL") {
    await upsertAlert(env, {
      id: stableId("alert:gdacs", eventIdRaw),
      level: alertLevel,
      eventId,
      title: `${alertLevel}: ${item.title}`,
      reason: sanitizeMessage(`GDACS reports alert level ${alertLevelRaw}. Treat as an official aggregated statement; local impact remains separately assessed.`),
      eventConfidence: 0.62,
      assessmentConfidence: 0.52
    });
  }

  return true;
}

function inferType(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("earthquake")) return "earthquake";
  if (lower.includes("flood")) return "flood";
  if (lower.includes("cyclone") || lower.includes("storm")) return "cyclone";
  if (lower.includes("volcano")) return "volcano";
  if (lower.includes("drought")) return "drought";
  if (lower.includes("fire")) return "forest_fire";
  return "disaster";
}
