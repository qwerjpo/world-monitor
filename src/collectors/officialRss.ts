import { parseFeed } from "../core/rss";
import {
  feedSourceId,
  incrementAccounting,
  insertClaim,
  insertEvidence,
  parseOfficialFeeds,
  recordCollectorFailure,
  recordCollectorSuccess,
  startCollectionRun
} from "../db";
import type { CollectorResult, Env, OfficialFeedConfig } from "../types";
import { parseNumber, sha256, stableId } from "../utils";

export async function collectOfficialRss(env: Env): Promise<CollectorResult> {
  const runId = await startCollectionRun(env, "official_rss");
  const interval = 60;
  try {
    await incrementAccounting(env, "collector_run");
    const feeds = parseOfficialFeeds(env);
    let itemsFound = 0;
    let itemsNew = 0;
    let itemsFailed = 0;

    for (const feed of feeds) {
      try {
        const result = await collectOneFeed(env, feed);
        itemsFound += result.itemsFound;
        itemsNew += result.itemsNew;
        itemsFailed += result.itemsFailed;
      } catch {
        itemsFailed += 1;
      }
    }

    const result = { collector: "official_rss" as const, itemsFound, itemsNew, itemsFailed };
    await recordCollectorSuccess(env, "official_rss", interval, result.itemsFound, result.itemsNew, result.itemsFailed, runId);
    return result;
  } catch (error) {
    await recordCollectorFailure(env, "official_rss", interval, runId, error);
    throw error;
  }
}

async function collectOneFeed(env: Env, feed: OfficialFeedConfig): Promise<{ itemsFound: number; itemsNew: number; itemsFailed: number }> {
  const response = await fetch(feed.url, { headers: { accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" } });
  if (!response.ok) throw new Error(`${feed.name} returned ${response.status}`);
  const items = parseFeed(await response.text()).slice(0, parseNumber(env.OFFICIAL_RSS_MAX_ITEMS_PER_FEED, 30));
  let itemsNew = 0;
  let itemsFailed = 0;

  for (const item of items) {
    try {
      const sourceId = feedSourceId(feed);
      const normalized = {
        source: feed.name,
        semantics: "official_publication_statement",
        warning: "official status means STATEMENT_FACT by default, not CONFIRMED_FACT",
        feedId: feed.id,
        itemId: item.id,
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
        summary: item.summary
      };
      const contentHash = await sha256(JSON.stringify(normalized));
      const evidence = await insertEvidence(env, {
        sourceId,
        externalId: item.id,
        canonicalUrl: item.link,
        originalUrl: item.link,
        publishedAt: item.publishedAt ?? item.updatedAt,
        contentHash,
        originGroup: `${sourceId}:${item.id}`,
        mediaType: "rss",
        language: feed.language,
        verificationStatus: "UNVERIFIED",
        rawText: `${item.title} ${item.summary ?? ""}`.trim(),
        normalized
      });
      if (!evidence.inserted) continue;
      itemsNew += 1;
      await insertClaim(env, {
        id: stableId("claim:rss", `${sourceId}:${item.id}`),
        text: `${feed.name} published: ${item.title}`,
        epistemicTag: "STATEMENT_FACT",
        region: feed.region,
        domain: feed.domain ?? "official_statement",
        pScore: 2,
        iScore: 2,
        vScore: 2,
        evidenceRank: `${sourceId}:${item.id}`,
        eventConfidence: 0.45
      }, evidence.id, {
        collector: "official_rss",
        domain: feed.domain ?? "official_statement",
        region: feed.region,
        novelty: evidence.inserted ? "NEW" : "DUPLICATE",
        scenarioMatch: false,
        indicatorMatch: false
      });
    } catch {
      itemsFailed += 1;
    }
  }

  return { itemsFound: items.length, itemsNew, itemsFailed };
}
