import {
  eventConfidenceFromOfficialObservation,
  labelEarthquakeAlert
} from "../core/epistemics";
import {
  insertClaim,
  insertEvidence,
  recordCollectorFailure,
  recordCollectorSuccess,
  startCollectionRun,
  upsertAlert,
  upsertEvent
} from "../db";
import type { CollectorResult, Env } from "../types";
import { incrementAccounting } from "../db";
import { parseNumber, sanitizeMessage, sha256, stableId } from "../utils";

interface UsgsFeature {
  id: string;
  properties: {
    mag?: number;
    place?: string;
    time?: number;
    updated?: number;
    url?: string;
    detail?: string;
    alert?: string;
    status?: string;
    tsunami?: number;
    sig?: number;
    net?: string;
    code?: string;
    type?: string;
  };
  geometry?: {
    type: "Point";
    coordinates: [number, number, number];
  };
}

interface UsgsFeed {
  type: "FeatureCollection";
  metadata?: { title?: string; generated?: number; count?: number; status?: number };
  features: UsgsFeature[];
}

export async function collectUsgs(env: Env): Promise<CollectorResult> {
  const runId = await startCollectionRun(env, "usgs");
  const interval = 15;
  try {
    await incrementAccounting(env, "collector_run");
    const url = env.USGS_FEED_URL ?? "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
    const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" } });
    if (!response.ok) throw new Error(`USGS feed returned ${response.status}`);

    const feed = await response.json<UsgsFeed>();
    let itemsNew = 0;
    let itemsFailed = 0;

    const features = (feed.features ?? []).slice(0, parseNumber(env.USGS_MAX_ITEMS, 120));
    for (const feature of features) {
      try {
        const inserted = await ingestUsgsFeature(env, feature);
        if (inserted) itemsNew += 1;
      } catch {
        itemsFailed += 1;
      }
    }

    const result = { collector: "usgs" as const, itemsFound: features.length, itemsNew, itemsFailed };
    await recordCollectorSuccess(env, "usgs", interval, result.itemsFound, result.itemsNew, result.itemsFailed, runId);
    return result;
  } catch (error) {
    await recordCollectorFailure(env, "usgs", interval, runId, error);
    throw error;
  }
}

async function ingestUsgsFeature(env: Env, feature: UsgsFeature): Promise<boolean> {
  const props = feature.properties ?? {};
  const [longitude, latitude, depthKm] = feature.geometry?.coordinates ?? [undefined, undefined, undefined];
  const magnitude = Number(props.mag ?? 0);
  const place = props.place ?? "Unknown location";
  const publishedAt = props.time ? new Date(props.time).toISOString() : undefined;
  const normalized = {
    source: "USGS",
    semantics: "agency_observation_statement",
    warning: "official/primary source does not automatically imply confirmed downstream impact",
    usgsId: feature.id,
    magnitude,
    place,
    longitude,
    latitude,
    depthKm,
    tsunami: props.tsunami === 1,
    usgsAlert: props.alert ?? "UNKNOWN",
    status: props.status ?? "UNKNOWN",
    type: props.type ?? "earthquake",
    updatedAt: props.updated ? new Date(props.updated).toISOString() : undefined
  };
  const contentHash = await sha256(JSON.stringify(normalized));
  const evidence = await insertEvidence(env, {
    sourceId: "usgs_earthquake",
    externalId: feature.id,
    canonicalUrl: props.url,
    originalUrl: props.detail ?? props.url,
    publishedAt,
    contentHash,
    originGroup: `usgs:${feature.id}`,
    mediaType: "geojson",
    language: "en",
    verificationStatus: "UNVERIFIED",
    rawText: `${magnitude.toFixed(1)} earthquake reported near ${place}`,
    normalized
  });
  if (!evidence.inserted) return false;

  const eventId = stableId("event:usgs", feature.id);
  const confidence = eventConfidenceFromOfficialObservation(props.status);
  const impact = Math.min(1, Math.max(0, magnitude / 8));
  const urgency = props.tsunami === 1 ? 0.95 : Math.min(0.9, Math.max(0.1, (magnitude - 4) / 4));
  const alertLevel = labelEarthquakeAlert(magnitude, props.tsunami === 1);
  const status = alertLevel === "INFO" ? "UNCONFIRMED" : "TRACKING";

  await upsertEvent(env, {
    id: eventId,
    name: `Earthquake near ${place}`,
    eventType: "earthquake",
    region: place,
    domain: "disaster",
    status,
    startedAt: publishedAt,
    impact,
    urgency,
    eventConfidence: confidence,
    assessmentConfidence: 0.58,
    sourceQuality: 0.82,
    independentStreams: 1
  });

  await insertClaim(env, {
    id: stableId("claim:usgs", feature.id),
    text: `USGS reported a magnitude ${magnitude.toFixed(1)} earthquake near ${place}.`,
    epistemicTag: "STATEMENT_FACT",
    eventId,
    region: place,
    domain: "disaster",
    pScore: 1,
    iScore: 1,
    vScore: 3,
    evidenceRank: `usgs:${feature.id}`,
    eventConfidence: confidence
  }, evidence.id, {
    collector: "usgs",
    domain: "disaster",
    eventType: "earthquake",
    region: place,
    impact,
    urgency,
    eventConfidence: confidence,
    alertLevel,
    novelty: evidence.inserted ? "NEW" : "DUPLICATE",
    baselineDeviation: magnitude >= 6.5 ? 2 : magnitude >= 5.5 ? 1 : 0,
    highImpactLowConfidence: impact >= 0.85 && confidence < 0.5
  });

  if (alertLevel === "WARNING" || alertLevel === "CRITICAL") {
    await upsertAlert(env, {
      id: stableId("alert:usgs", feature.id),
      level: alertLevel,
      eventId,
      title: `${alertLevel}: M${magnitude.toFixed(1)} earthquake`,
      reason: sanitizeMessage(`USGS reports M${magnitude.toFixed(1)} near ${place}. Event confidence and impact confidence are tracked separately; tsunami flag: ${props.tsunami === 1 ? "yes" : "no"}.`),
      eventConfidence: confidence,
      assessmentConfidence: 0.58
    });
  }

  return true;
}
