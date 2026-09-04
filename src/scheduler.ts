import { notifyPendingTelegramAlerts } from "./alerts/telegram";
import { collectGdacs } from "./collectors/gdacs";
import { collectOfficialRss } from "./collectors/officialRss";
import { collectUsgs } from "./collectors/usgs";
import {
  budgetState,
  enqueueCollector,
  ensureDefaults,
  finishFallbackJob,
  recordSystemState,
  scheduleNextRun,
  takeFallbackCollectorJobs
} from "./db";
import { syncImportantNotionProjections } from "./notion/sync";
import type { CollectorMessage, CollectorName, Env } from "./types";
import { nowIso, parseNumber } from "./utils";

export async function runScheduler(env: Env): Promise<{ dispatched: number; processedFallback: number; budgetMode: string }> {
  await ensureDefaults(env);
  await recordSystemState(env, "last_scheduler_run", nowIso());
  const budget = await budgetState(env);
  await recordSystemState(env, "budget", budget);

  const maxRuns = parseNumber(env.MAX_COLLECTOR_RUNS_PER_SCHEDULE, 6);
  const dueJobs = await env.DB.prepare(
    `SELECT id, collector, priority, interval_min, config_json
     FROM collector_jobs
     WHERE enabled = 1 AND next_run_at <= CURRENT_TIMESTAMP
     ORDER BY priority ASC, next_run_at ASC
     LIMIT ?`
  ).bind(maxRuns).all<{ id: string; collector: CollectorName; priority: number; interval_min: number; config_json: string | null }>();

  let dispatched = 0;
  for (const job of dueJobs.results) {
    if (budget.mode === "DEGRADED" && job.priority > 20) continue;
    const config = job.config_json ? JSON.parse(job.config_json) as Record<string, unknown> : {};
    await enqueueCollector(env, { collector: job.collector, jobId: job.id, config }, job.priority);
    await scheduleNextRun(env, job.id, job.interval_min);
    dispatched += 1;
  }

  let processedFallback = 0;
  for (const job of await takeFallbackCollectorJobs(env, maxRuns)) {
    try {
      await runCollector(env, job.message);
      await finishFallbackJob(env, job.id);
      processedFallback += 1;
    } catch (error) {
      await finishFallbackJob(env, job.id, error);
    }
  }

  const telegram = await notifyPendingTelegramAlerts(env);
  const notion = await syncImportantNotionProjections(env);
  await recordSystemState(env, "telegram_alerts", telegram);
  await recordSystemState(env, "notion_projection", notion);

  return { dispatched, processedFallback, budgetMode: budget.mode };
}

export async function runCollector(env: Env, message: CollectorMessage) {
  switch (message.collector) {
    case "usgs":
      return collectUsgs(env);
    case "gdacs":
      return collectGdacs(env);
    case "official_rss":
      return collectOfficialRss(env);
  }
}
