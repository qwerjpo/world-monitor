export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  AI?: unknown;
  COLLECT_QUEUE?: Queue<CollectorMessage>;
  ANALYZE_QUEUE?: Queue<AnalysisMessage>;
  NOTION_QUEUE?: Queue<ProjectionMessage>;
  ALERT_QUEUE?: Queue<AlertMessage>;
  INTERNAL_INGEST_TOKEN?: string;
  NOTION_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  USGS_FEED_URL?: string;
  GDACS_FEED_URL?: string;
  OFFICIAL_RSS_FEEDS?: string;
  AI_MODEL?: string;
  MAX_COLLECTOR_RUNS_PER_SCHEDULE?: string;
  FREE_TIER_DAILY_REQUEST_SOFT_LIMIT?: string;
  FREE_TIER_DAILY_COLLECTOR_RUN_SOFT_LIMIT?: string;
  AI_DAILY_REQUEST_SOFT_LIMIT?: string;
  AI_DAILY_ESTIMATED_UNIT_SOFT_LIMIT?: string;
  NOTIFICATION_ENABLE_AFTER?: string;
  USGS_MAX_ITEMS?: string;
  GDACS_MAX_ITEMS?: string;
  OFFICIAL_RSS_MAX_ITEMS_PER_FEED?: string;
  NOTION_ALERTS_DATA_SOURCE_ID?: string;
  NOTION_EVENTS_DATA_SOURCE_ID?: string;
  NOTION_TRENDS_DATA_SOURCE_ID?: string;
  NOTION_SCENARIOS_DATA_SOURCE_ID?: string;
  NOTION_INDICATORS_DATA_SOURCE_ID?: string;
  NOTION_ASSESSMENTS_DATA_SOURCE_ID?: string;
  NOTION_FORECAST_LEDGER_DATA_SOURCE_ID?: string;
  NOTION_HIGH_VALUE_CLAIMS_DATA_SOURCE_ID?: string;
  NOTION_SOURCES_DATA_SOURCE_ID?: string;
  NOTION_SYSTEM_HEALTH_DATA_SOURCE_ID?: string;
}

export type AlertLevel = "INFO" | "WATCH" | "WARNING" | "CRITICAL";
export type CollectorName = "usgs" | "gdacs" | "official_rss";

export interface CollectorMessage {
  collector: CollectorName;
  jobId?: string;
  config?: Record<string, unknown>;
}

export interface AnalysisMessage {
  objectType: string;
  objectId: string;
  reason: string;
  priority?: number;
}

export interface ProjectionMessage {
  objectType: string;
  objectId: string;
}

export interface AlertMessage {
  alertId: string;
}

export interface CollectorResult {
  collector: CollectorName;
  itemsFound: number;
  itemsNew: number;
  itemsFailed: number;
}

export interface EvidenceInput {
  id?: string;
  sourceId: string;
  externalId?: string;
  canonicalUrl?: string;
  originalUrl?: string;
  publishedAt?: string;
  contentHash?: string;
  originGroup?: string;
  mediaType?: string;
  language?: string;
  verificationStatus?: string;
  rawText?: string;
  normalized: Record<string, unknown>;
}

export interface EventInput {
  id: string;
  name: string;
  eventType: string;
  region?: string;
  domain: string;
  status: string;
  startedAt?: string;
  impact: number;
  urgency: number;
  eventConfidence: number;
  assessmentConfidence: number;
  sourceQuality: number;
  independentStreams: number;
}

export interface ClaimInput {
  id: string;
  text: string;
  epistemicTag: "STATEMENT_FACT" | "CONFIRMED_FACT" | "UNCONFIRMED";
  eventId?: string;
  region?: string;
  domain?: string;
  pScore: number;
  iScore: number;
  vScore: number;
  evidenceRank: string;
  eventConfidence: number;
}

export interface AnalysisGateInput {
  collector: "usgs" | "gdacs" | "official_rss" | "manual" | "telegram";
  domain?: string;
  eventType?: string;
  region?: string;
  impact?: number;
  urgency?: number;
  eventConfidence?: number;
  alertLevel?: AlertLevel;
  novelty?: "NEW" | "DUPLICATE";
  severityText?: string;
  scenarioMatch?: boolean;
  indicatorMatch?: boolean;
  baselineDeviation?: number;
  crossDomainConvergence?: boolean;
  highImpactLowConfidence?: boolean;
}

export interface AlertInput {
  id: string;
  level: AlertLevel;
  eventId?: string;
  scenarioId?: string;
  title: string;
  reason: string;
  eventConfidence: number;
  assessmentConfidence: number;
  operationalMetric?: boolean;
  notificationEligibleAt?: string | null;
  auditClass?: string;
  auditNote?: string;
}

export interface OfficialFeedConfig {
  id: string;
  name: string;
  url: string;
  region?: string;
  domain?: string;
  language?: string;
  priority?: number;
  pollInterval?: number;
}
