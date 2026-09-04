const statusLine = document.querySelector("#status-line");
const refresh = document.querySelector("#refresh");

refresh.addEventListener("click", load);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

load();

async function load() {
  statusLine.textContent = "Refreshing...";
  const [health, alerts, events] = await Promise.all([
    getJson("/health"),
    getJson("/api/alerts"),
    getJson("/api/events")
  ]);

  document.querySelector("#service").textContent = health.ok ? "Online" : "Check";
  document.querySelector("#budget").textContent = health.budget?.mode ?? "Unknown";
  document.querySelector("#notion").textContent = health.notion?.configured ? "Ready" : "Off";
  document.querySelector("#telegram").textContent = health.notification?.telegramConfigured ? "Ready" : "Off";
  document.querySelector("#scheduler").textContent = health.scheduler?.lastRun ? `Last run ${timeAgo(health.scheduler.lastRun)}` : "No run yet";

  renderCollectors(health.collectors ?? []);
  renderRows("#alerts", alerts.items ?? [], (item) => ({
    title: item.title,
    meta: `${item.reason ?? ""} Event confidence: ${percent(item.event_confidence)} | Assessment: ${percent(item.assessment_confidence)}`,
    badge: item.alert_level
  }));
  renderRows("#events", events.items ?? [], (item) => ({
    title: item.name,
    meta: `${item.region ?? "Unknown region"} | ${item.domain ?? "unknown"} | confidence ${percent(item.event_confidence)}`,
    badge: item.status ?? "UNKNOWN"
  }));
  statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} failed`);
  return response.json();
}

function renderCollectors(items) {
  renderRows("#collectors", items, (item) => ({
    title: item.collector,
    meta: `Last success: ${item.last_success ? timeAgo(item.last_success) : "never"} | data gap: ${item.data_gap_minutes ?? "unknown"} min | failures: ${item.consecutive_failures ?? 0}`,
    badge: item.health ?? "UNKNOWN"
  }));
}

function renderRows(selector, items, map) {
  const root = document.querySelector(selector);
  root.innerHTML = "";
  if (items.length === 0) {
    root.innerHTML = '<div class="empty">No records yet.</div>';
    return;
  }
  for (const item of items.slice(0, 12)) {
    const row = map(item);
    const element = document.createElement("article");
    const badge = String(row.badge ?? "UNKNOWN");
    element.className = "row";
    element.innerHTML = `
      <div>
        <span class="row-title"></span>
        <span class="row-meta"></span>
      </div>
      <span class="badge ${badge}"></span>
    `;
    element.querySelector(".row-title").textContent = row.title ?? "Untitled";
    element.querySelector(".row-meta").textContent = row.meta ?? "";
    element.querySelector(".badge").textContent = badge;
    root.appendChild(element);
  }
}

function percent(value) {
  if (typeof value !== "number") return "unknown";
  return `${Math.round(value * 100)}%`;
}

function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
