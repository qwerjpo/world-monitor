ALTER TABLE alerts ADD COLUMN notification_eligible_at TEXT;
ALTER TABLE alerts ADD COLUMN audit_class TEXT;
ALTER TABLE alerts ADD COLUMN audit_note TEXT;
ALTER TABLE alerts ADD COLUMN operational_metric INTEGER NOT NULL DEFAULT 1;

ALTER TABLE analysis_queue ADD COLUMN gate_status TEXT NOT NULL DEFAULT 'LEGACY_UNGATED';
ALTER TABLE analysis_queue ADD COLUMN gate_reason TEXT;

CREATE TABLE IF NOT EXISTS analysis_gate_decisions (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id),
  evidence_id TEXT REFERENCES evidence(id),
  decision TEXT NOT NULL,
  score REAL NOT NULL,
  reason_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analysis_gate_claim ON analysis_gate_decisions(claim_id);
CREATE INDEX IF NOT EXISTS idx_analysis_gate_decision ON analysis_gate_decisions(decision, created_at);

CREATE TABLE IF NOT EXISTS alert_audit (
  alert_id TEXT PRIMARY KEY REFERENCES alerts(id),
  audit_class TEXT NOT NULL,
  trigger_summary TEXT NOT NULL,
  proposed_threshold_correction TEXT,
  audited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notion_schema_cache (
  data_source_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_provenance (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_budget_usage (
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  estimated_units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(day, model)
);

CREATE INDEX IF NOT EXISTS idx_alerts_notification_cutoff
  ON alerts(status, alert_level, notification_sent, notification_eligible_at);

UPDATE analysis_queue
SET status = 'SKIPPED_PRE_GATE',
    gate_status = 'RETIRED_LEGACY_UNGATED',
    gate_reason = 'Phase 1.5 hardening: queue entry was created before deterministic materiality gating.'
WHERE status = 'PENDING'
  AND gate_status = 'LEGACY_UNGATED';

UPDATE alerts
SET audit_class = 'TEST_GENERATED',
    audit_note = 'Synthetic Phase 1 manual WARNING verification alert.',
    operational_metric = 0,
    notification_eligible_at = NULL
WHERE id = 'alert:phase1:manual';

INSERT OR REPLACE INTO alert_audit
  (alert_id, audit_class, trigger_summary, proposed_threshold_correction)
SELECT
  id,
  'TEST_GENERATED',
  title || ' | ' || COALESCE(reason, ''),
  'Exclude synthetic/manual verification alerts from operational metrics and Telegram eligibility unless explicitly marked operational.'
FROM alerts
WHERE id = 'alert:phase1:manual';

UPDATE alerts
SET audit_class = 'THRESHOLD_FALSE_POSITIVE',
    audit_note = 'USGS tsunami flag created WARNING below material earthquake threshold; requires higher magnitude gate.',
    operational_metric = 0,
    notification_eligible_at = NULL
WHERE id IN ('alert:usgs:us7000te7l', 'alert:usgs:us7000tdys');

INSERT OR REPLACE INTO alert_audit
  (alert_id, audit_class, trigger_summary, proposed_threshold_correction)
SELECT
  id,
  'THRESHOLD_FALSE_POSITIVE',
  title || ' | ' || COALESCE(reason, ''),
  'Require magnitude >= 6.0 for tsunami-flag WARNING and >= 7.0 for tsunami-flag CRITICAL; keep lower-magnitude tsunami-flag items as WATCH/tracking only.'
FROM alerts
WHERE id IN ('alert:usgs:us7000te7l', 'alert:usgs:us7000tdys');

UPDATE alerts
SET audit_class = CASE
      WHEN title LIKE '%Drought is on going%' THEN 'STALE/HISTORICAL'
      ELSE 'REAL'
    END,
    audit_note = CASE
      WHEN title LIKE '%Drought is on going%' THEN 'Ongoing drought item from GDACS feed; track as event but do not send as immediate notification backlog.'
      ELSE 'Official GDACS active alert; preserve in D1 but do not send retroactive backlog after credential enablement.'
    END,
    notification_eligible_at = NULL
WHERE alert_level IN ('WARNING', 'CRITICAL')
  AND audit_class IS NULL;

INSERT OR REPLACE INTO alert_audit
  (alert_id, audit_class, trigger_summary, proposed_threshold_correction)
SELECT
  id,
  audit_class,
  title || ' | ' || COALESCE(reason, ''),
  CASE
    WHEN audit_class = 'STALE/HISTORICAL' THEN 'Require recency/escalation signal for ongoing drought notifications; keep stale historical items visible but non-notifying.'
    WHEN audit_class = 'THRESHOLD_FALSE_POSITIVE' THEN 'Require magnitude >= 6.0 for tsunami-flag WARNING and >= 7.0 for tsunami-flag CRITICAL; keep lower-magnitude tsunami-flag items as WATCH/tracking only.'
    WHEN audit_class = 'TEST_GENERATED' THEN 'Exclude synthetic/manual verification alerts from operational metrics and Telegram eligibility unless explicitly marked operational.'
    ELSE NULL
  END
FROM alerts
WHERE alert_level IN ('WARNING', 'CRITICAL');
