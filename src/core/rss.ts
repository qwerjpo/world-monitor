import { XMLParser } from "fast-xml-parser";

export interface ParsedFeedItem {
  id: string;
  title: string;
  link?: string;
  publishedAt?: string;
  updatedAt?: string;
  summary?: string;
  raw: Record<string, unknown>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  trimValues: true
});

export function parseFeed(xml: string): ParsedFeedItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rssChannel = getPath<Record<string, unknown>>(parsed, ["rss", "channel"]);
  if (rssChannel) {
    const items = asArray<Record<string, unknown>>(rssChannel.item);
    return items.map((item, index) => normalizeRssItem(item, index));
  }

  const feed = getPath<Record<string, unknown>>(parsed, ["feed"]);
  if (feed) {
    const entries = asArray<Record<string, unknown>>(feed.entry);
    return entries.map((entry, index) => normalizeAtomEntry(entry, index));
  }

  return [];
}

export function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record["#text"]) ?? textValue(record._text) ?? textValue(record["@_href"]);
  }
  return undefined;
}

function normalizeRssItem(item: Record<string, unknown>, index: number): ParsedFeedItem {
  const link = textValue(item.link);
  const id = textValue(item.guid) ?? textValue(item["gdacs:eventid"]) ?? link ?? `rss-item-${index}`;
  return {
    id,
    title: textValue(item.title) ?? "Untitled feed item",
    link,
    publishedAt: normalizeDate(textValue(item.pubDate) ?? textValue(item["dc:date"])),
    updatedAt: normalizeDate(textValue(item.updated)),
    summary: textValue(item.description),
    raw: item
  };
}

function normalizeAtomEntry(entry: Record<string, unknown>, index: number): ParsedFeedItem {
  const linkValue = Array.isArray(entry.link) ? entry.link[0] : entry.link;
  const link = textValue(linkValue);
  const id = textValue(entry.id) ?? link ?? `atom-entry-${index}`;
  return {
    id,
    title: textValue(entry.title) ?? "Untitled feed entry",
    link,
    publishedAt: normalizeDate(textValue(entry.published)),
    updatedAt: normalizeDate(textValue(entry.updated)),
    summary: textValue(entry.summary) ?? textValue(entry.content),
    raw: entry
  };
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getPath<T>(source: Record<string, unknown>, path: string[]): T | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
}

function asArray<T>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
