import type { Env } from "../types";
import { sanitizeMessage } from "../utils";

export async function notifyPendingTelegramAlerts(env: Env): Promise<{ attempted: number; sent: number; configured: boolean }> {
  const configured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  const cutoff = env.NOTIFICATION_ENABLE_AFTER?.trim() || "1970-01-01T00:00:00.000Z";
  const rows = await env.DB.prepare(
    `SELECT id, alert_level, title, reason, event_confidence, assessment_confidence
     FROM alerts
     WHERE status = 'ACTIVE'
       AND notification_sent = 0
       AND notification_eligible_at IS NOT NULL
       AND notification_eligible_at <= CURRENT_TIMESTAMP
       AND notification_eligible_at >= ?
       AND COALESCE(operational_metric, 1) = 1
       AND COALESCE(audit_class, 'REAL') NOT IN ('TEST_GENERATED', 'THRESHOLD_FALSE_POSITIVE', 'STALE/HISTORICAL')
       AND alert_level IN ('WARNING', 'CRITICAL')
     ORDER BY issued_at ASC
     LIMIT 10`
  ).bind(cutoff).all<{
    id: string;
    alert_level: string;
    title: string;
    reason: string | null;
    event_confidence: number | null;
    assessment_confidence: number | null;
  }>();

  let sent = 0;
  for (const alert of rows.results) {
    if (!configured) break;
    const ok = await sendTelegramMessage(env, formatAlert(alert));
    if (ok) {
      sent += 1;
      await env.DB.prepare("UPDATE alerts SET notification_sent = 1 WHERE id = ?").bind(alert.id).run();
    }
  }

  return { attempted: rows.results.length, sent, configured };
}

export async function sendTelegramMessage(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: sanitizeMessage(text, 3500),
      disable_web_page_preview: true
    })
  });
  return response.ok;
}

function formatAlert(alert: {
  alert_level: string;
  title: string;
  reason: string | null;
  event_confidence: number | null;
  assessment_confidence: number | null;
}): string {
  const eventConfidence = Math.round((alert.event_confidence ?? 0) * 100);
  const assessmentConfidence = Math.round((alert.assessment_confidence ?? 0) * 100);
  return [
    `[${alert.alert_level}] ${alert.title}`,
    alert.reason ?? "No reason recorded.",
    `Event confidence: ${eventConfidence}%`,
    `Assessment confidence: ${assessmentConfidence}%`
  ].join("\n");
}
