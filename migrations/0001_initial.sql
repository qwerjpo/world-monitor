PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  country TEXT,
  organization TEXT,
  language TEXT,
  official_status TEXT,
  default_interest_level INTEGER,
  default_proximity INTEGER,
  default_verifiability INTEGER,
  collection_method TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 50,
  expected_interval_min INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_endpoints (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  endpoint_type TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  api_name TEXT,
  parser TEXT,
  poll_interval INTEGER,
  last_success_at TEXT,
  last_item_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_id, endpoint_type, url, channel_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT,
  canonical_url TEXT,
  original_url TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT,
  origin_group TEXT,
  media_type TEXT,
  language TEXT,
  archive_level TEXT NOT NULL DEFAULT 'E0',
  vault_path TEXT,
  deleted_at_source TEXT,
  edited_at_source TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  raw_text TEXT,
  normalized_json TEXT,
  UNIQUE(source_id, external_id),
  UNIQUE(content_hash, source_id)
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  country TEXT,
  parent_entity TEXT REFERENCES entities(id),
  latitude REAL,
  longitude REAL,
  imo TEXT,
  mmsi TEXT,
  icao24 TEXT,
  norad_id TEXT,
  wikidata_id TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL,
  language TEXT,
  source TEXT,
  PRIMARY KEY(entity_id, alias)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT,
  region TEXT,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  started_at TEXT,
  ended_at TEXT,
  impact REAL NOT NULL DEFAULT 0,
  urgency REAL NOT NULL DEFAULT 0,
  event_confidence REAL,
  assessment_confidence REAL,
  source_quality REAL,
  independent_streams INTEGER NOT NULL DEFAULT 0,
  last_update TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_review TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  claim_text TEXT NOT NULL,
  epistemic_tag TEXT NOT NULL,
  actor_entity_id TEXT REFERENCES entities(id),
  event_id TEXT REFERENCES events(id),
  region TEXT,
  domain TEXT,
  p_score INTEGER,
  i_score INTEGER,
  v_score INTEGER,
  evidence_rank TEXT,
  event_confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'TRACKING'
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  relationship TEXT,
  independent_stream TEXT,
  supports INTEGER NOT NULL DEFAULT 0,
  contradicts INTEGER NOT NULL DEFAULT 0,
  origin_group TEXT,
  PRIMARY KEY(claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS trends (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  domain TEXT,
  direction TEXT,
  velocity TEXT,
  strength REAL,
  confidence REAL,
  started_at TEXT,
  last_assessment TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  domain TEXT,
  time_horizon TEXT,
  current_probability REAL,
  previous_probability REAL,
  confidence REAL,
  alert_level TEXT NOT NULL DEFAULT 'INFO',
  valid_until TEXT,
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS indicators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  domain TEXT,
  severity REAL,
  lead_time TEXT,
  baseline_type TEXT,
  baseline_value TEXT,
  current_value TEXT,
  state TEXT NOT NULL DEFAULT 'NORMAL',
  reliability REAL,
  last_observed TEXT
);

CREATE TABLE IF NOT EXISTS indicator_observations (
  id TEXT PRIMARY KEY,
  indicator_id TEXT NOT NULL REFERENCES indicators(id),
  event_id TEXT REFERENCES events(id),
  evidence_id TEXT REFERENCES evidence(id),
  observed_at TEXT NOT NULL,
  value TEXT,
  confidence REAL,
  independent_stream TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  narrative TEXT NOT NULL,
  origin_group TEXT,
  target_audience TEXT,
  first_seen TEXT,
  velocity TEXT,
  reach_level TEXT,
  verification_state TEXT,
  likely_beneficiary TEXT,
  confidence REAL
);

CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY,
  registered_at TEXT NOT NULL,
  forecast_text TEXT NOT NULL,
  scenario_id TEXT REFERENCES scenarios(id),
  probability REAL NOT NULL,
  confidence REAL,
  expected_by TEXT,
  falsification_condition TEXT,
  result TEXT NOT NULL DEFAULT 'PENDING',
  score REAL,
  error_type TEXT,
  evaluated_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  alert_level TEXT NOT NULL,
  event_id TEXT REFERENCES events(id),
  scenario_id TEXT REFERENCES scenarios(id),
  title TEXT NOT NULL,
  reason TEXT,
  event_confidence REAL,
  assessment_confidence REAL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notification_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  collector TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  api_status TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS analysis_queue (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  analysis_level TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS source_performance (
  source_id TEXT NOT NULL REFERENCES sources(id),
  domain TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  total_claims INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  disproved INTEGER NOT NULL DEFAULT 0,
  unresolved INTEGER NOT NULL DEFAULT 0,
  accuracy REAL,
  last_calculated TEXT,
  PRIMARY KEY(source_id, domain, claim_type)
);

CREATE TABLE IF NOT EXISTS indicator_performance (
  indicator_id TEXT PRIMARY KEY REFERENCES indicators(id),
  observations INTEGER NOT NULL DEFAULT 0,
  true_positive INTEGER NOT NULL DEFAULT 0,
  false_positive INTEGER NOT NULL DEFAULT 0,
  false_negative INTEGER NOT NULL DEFAULT 0,
  lead_time_avg REAL,
  performance_score REAL
);

CREATE TABLE IF NOT EXISTS collector_jobs (
  id TEXT PRIMARY KEY,
  collector TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 50,
  interval_min INTEGER NOT NULL,
  next_run_at TEXT NOT NULL,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS collector_health (
  collector TEXT PRIMARY KEY,
  last_success TEXT,
  expected_interval INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  data_gap_minutes INTEGER,
  health TEXT NOT NULL DEFAULT 'UNKNOWN',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notion_map (
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  notion_page_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(object_type, object_id)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_published ON evidence(published_at);
CREATE INDEX IF NOT EXISTS idx_evidence_origin ON evidence(origin_group);
CREATE INDEX IF NOT EXISTS idx_claims_event ON claims(event_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_last_update ON events(last_update);
CREATE INDEX IF NOT EXISTS idx_scenarios_alert ON scenarios(alert_level);
CREATE INDEX IF NOT EXISTS idx_indicators_state ON indicators(state);
CREATE INDEX IF NOT EXISTS idx_analysis_queue_status ON analysis_queue(status, priority);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, alert_level);
CREATE INDEX IF NOT EXISTS idx_collector_jobs_due ON collector_jobs(enabled, next_run_at);
