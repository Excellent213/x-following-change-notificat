const DEFAULT_POLL_INTERVAL_MS = 300_000;
const MIN_POLL_INTERVAL_MS = 300_000;
const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

function cleanString(value, fallback = "") {
  return String(value || fallback).trim();
}

function parseInterval(value) {
  const n = Number(value || DEFAULT_POLL_INTERVAL_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(Math.floor(n), MAX_POLL_INTERVAL_MS));
}

function parseNotificationMode(value) {
  const mode = cleanString(value || "post").toLowerCase();
  if (mode === "dm") return "dm";
  return "post";
}

export function loadConfig() {
  return {
    MONGODB_URI: cleanString(process.env.MONGODB_URI || ""),
    COOKMYBOTS_X_ENDPOINT: cleanString(process.env.COOKMYBOTS_X_ENDPOINT || ""),
    COOKMYBOTS_X_KEY: cleanString(process.env.COOKMYBOTS_X_KEY || ""),
    X_MONITORED_USERNAME: cleanString(process.env.X_MONITORED_USERNAME || "").replace(/^@/, ""),
    X_POLL_INTERVAL_MS: parseInterval(process.env.X_POLL_INTERVAL_MS || process.env.POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
    X_NOTIFICATION_MODE: parseNotificationMode(process.env.X_NOTIFICATION_MODE || "post"),
    X_NOTIFICATION_TARGET_USER_ID: cleanString(process.env.X_NOTIFICATION_TARGET_USER_ID || ""),
    X_DEBUG: cleanString(process.env.X_DEBUG || "0") === "1",
    X_LOG_BODY: cleanString(process.env.X_LOG_BODY || "0") === "1",
    MAX_FOLLOWING_PAGES_PER_SCAN: Math.max(1, Math.min(Number(process.env.MAX_FOLLOWING_PAGES_PER_SCAN || 50), 200))
  };
}
