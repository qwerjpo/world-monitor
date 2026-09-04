import type { AlertLevel } from "../types";

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

export interface AnalysisGateDecision {
  shouldQueue: boolean;
  score: number;
  reasons: string[];
}

const highPriorityRegions = [
  "taiwan",
  "ukraine",
  "russia",
  "china",
  "iran",
  "israel",
  "gaza",
  "red sea",
  "korean peninsula",
  "south china sea",
  "japan"
];

export function decideAnalysisGate(input: AnalysisGateInput): AnalysisGateDecision {
  const reasons: string[] = [];
  let score = 0;
  const impact = input.impact ?? 0;
  const urgency = input.urgency ?? 0;

  if (input.novelty === "NEW") {
    score += 0.08;
    reasons.push("new evidence");
  }
  if (impact >= 0.85 || urgency >= 0.85) {
    score += 0.45;
    reasons.push("high impact or urgency");
  } else if (impact >= 0.7 || urgency >= 0.7) {
    score += 0.28;
    reasons.push("material impact or urgency");
  }
  if (input.alertLevel === "CRITICAL") {
    score += 0.45;
    reasons.push("critical alert");
  } else if (input.alertLevel === "WARNING") {
    score += 0.25;
    reasons.push("warning alert");
  }
  if (input.highImpactLowConfidence) {
    score += 0.35;
    reasons.push("high-impact low-confidence override");
  }
  if (input.scenarioMatch || input.indicatorMatch) {
    score += 0.3;
    reasons.push("scenario or indicator match");
  }
  if ((input.baselineDeviation ?? 0) >= 2) {
    score += 0.25;
    reasons.push("baseline deviation");
  }
  if (input.crossDomainConvergence) {
    score += 0.2;
    reasons.push("cross-domain convergence");
  }
  if (isHighPriorityRegion(input.region)) {
    score += 0.1;
    reasons.push("priority region");
  }

  const threshold = input.collector === "official_rss" ? 0.75 : 0.7;
  const shouldQueue = score >= threshold;
  if (!shouldQueue) reasons.push("below deterministic materiality threshold");
  return { shouldQueue, score: Number(score.toFixed(2)), reasons };
}

function isHighPriorityRegion(region?: string): boolean {
  const value = (region ?? "").toLowerCase();
  return highPriorityRegions.some((candidate) => value.includes(candidate));
}
