import type { AlertLevel } from "../types";

export interface HealthInput {
  now: Date;
  lastSuccess?: string | null;
  expectedIntervalMinutes?: number | null;
  consecutiveFailures?: number | null;
}

export interface HealthAssessment {
  health: "GREEN" | "YELLOW" | "ORANGE" | "RED" | "UNKNOWN";
  dataGapMinutes: number | null;
}

export function computeCollectorHealth(input: HealthInput): HealthAssessment {
  const expected = input.expectedIntervalMinutes ?? 60;
  const failures = input.consecutiveFailures ?? 0;
  if (!input.lastSuccess) {
    return {
      health: failures >= 3 ? "RED" : failures > 0 ? "ORANGE" : "UNKNOWN",
      dataGapMinutes: null
    };
  }

  const last = new Date(input.lastSuccess);
  const gap = Math.max(0, Math.floor((input.now.getTime() - last.getTime()) / 60000));
  if (failures >= 3 || gap > expected * 4) return { health: "RED", dataGapMinutes: gap };
  if (failures >= 2 || gap > expected * 2) return { health: "ORANGE", dataGapMinutes: gap };
  if (failures === 1 || gap > expected * 1.5) return { health: "YELLOW", dataGapMinutes: gap };
  return { health: "GREEN", dataGapMinutes: gap };
}

export function labelEarthquakeAlert(magnitude: number, tsunamiFlag = false): AlertLevel {
  if (magnitude >= 7.5 || (magnitude >= 7 && tsunamiFlag)) return "CRITICAL";
  if (magnitude >= 6.5 || (magnitude >= 6 && tsunamiFlag)) return "WARNING";
  if (magnitude >= 5.5 || tsunamiFlag) return "WATCH";
  return "INFO";
}

export function labelGdacsAlert(alertLevel?: string | null): AlertLevel {
  const value = (alertLevel ?? "").trim().toLowerCase();
  if (value === "red") return "CRITICAL";
  if (value === "orange") return "WARNING";
  if (value === "green") return "WATCH";
  return "INFO";
}

export function eventConfidenceFromOfficialObservation(status?: string | null): number {
  const value = (status ?? "").toLowerCase();
  if (value.includes("reviewed") || value.includes("confirmed")) return 0.82;
  return 0.68;
}

export function evidenceFingerprint(sourceId: string, externalId: string | undefined, contentHash: string): string {
  return `${sourceId}:${externalId && externalId.length > 0 ? externalId : contentHash}`;
}
