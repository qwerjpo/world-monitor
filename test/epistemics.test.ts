import { describe, expect, it } from "vitest";
import {
  computeCollectorHealth,
  evidenceFingerprint,
  labelEarthquakeAlert,
  labelGdacsAlert
} from "../src/core/epistemics";
import { decideAnalysisGate } from "../src/core/analysisGate";
import { buildPropertyMapping } from "../src/notion/sync";

describe("deduplication fingerprint", () => {
  it("prefers stable external IDs over content hash", () => {
    expect(evidenceFingerprint("usgs_earthquake", "ak123", "hash-a")).toBe(
      evidenceFingerprint("usgs_earthquake", "ak123", "hash-b")
    );
  });

  it("falls back to content hash when no external ID exists", () => {
    expect(evidenceFingerprint("official", undefined, "same-hash")).toBe("official:same-hash");
  });
});

describe("collector health", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");

  it("marks missing success with repeated failures as a data gap, not no activity", () => {
    expect(computeCollectorHealth({ now, consecutiveFailures: 3, expectedIntervalMinutes: 15 })).toEqual({
      health: "RED",
      dataGapMinutes: null
    });
  });

  it("marks stale collector success as orange before red", () => {
    expect(
      computeCollectorHealth({
        now,
        lastSuccess: "2026-09-03T23:20:00.000Z",
        expectedIntervalMinutes: 15,
        consecutiveFailures: 0
      }).health
    ).toBe("ORANGE");
  });
});

describe("alert labeling", () => {
  it("separates earthquake event severity from assessment confidence inputs", () => {
    expect(labelEarthquakeAlert(7.6, false)).toBe("CRITICAL");
    expect(labelEarthquakeAlert(6.6, false)).toBe("WARNING");
    expect(labelEarthquakeAlert(5.2, true)).toBe("WATCH");
    expect(labelEarthquakeAlert(5.6, false)).toBe("WATCH");
  });

  it("maps GDACS colors without treating source severity as proof of impact", () => {
    expect(labelGdacsAlert("Red")).toBe("CRITICAL");
    expect(labelGdacsAlert("Orange")).toBe("WARNING");
    expect(labelGdacsAlert("Green")).toBe("WATCH");
    expect(labelGdacsAlert(undefined)).toBe("INFO");
  });
});

describe("analysis gating", () => {
  it("stores routine feed claims without queueing every item for analysis", () => {
    const decision = decideAnalysisGate({
      collector: "usgs",
      domain: "disaster",
      eventType: "earthquake",
      region: "Routine offshore area",
      impact: 0.3,
      urgency: 0.2,
      eventConfidence: 0.82,
      alertLevel: "INFO",
      novelty: "NEW"
    });

    expect(decision.shouldQueue).toBe(false);
  });

  it("queues high-impact low-confidence cases for explicit review", () => {
    const decision = decideAnalysisGate({
      collector: "manual",
      domain: "security",
      region: "Taiwan",
      impact: 0.9,
      urgency: 0.9,
      eventConfidence: 0.32,
      alertLevel: "WARNING",
      novelty: "NEW",
      highImpactLowConfidence: true
    });

    expect(decision.shouldQueue).toBe(true);
  });
});

describe("Notion property mapping", () => {
  it("uses exact property names and types from a retrieved data source schema", () => {
    const mapping = buildPropertyMapping({
      id: "data-source",
      properties: {
        Alert: { id: "title", name: "Alert", type: "title" },
        "Alert Level": { id: "level", name: "Alert Level", type: "select" },
        "Current Status": { id: "status", name: "Current Status", type: "status" },
        "Trigger Summary": { id: "summary", name: "Trigger Summary", type: "rich_text" },
        "Issued Time": { id: "date", name: "Issued Time", type: "date" }
      }
    });

    expect(mapping).toMatchObject({
      title: "Alert",
      level: "Alert Level",
      status: "Current Status",
      summary: "Trigger Summary",
      timestamp: "Issued Time"
    });
  });
});
