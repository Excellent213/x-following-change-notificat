import { log, safeErr } from "../lib/logger.js";

function trimSlash(value) {
  let s = String(value || "");
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function bodySnippet(value) {
  if (!value) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.slice(0, 300);
}

function normalizeProxyResponse(httpStatus, json, text) {
  const status = Number(json?.status || httpStatus || 0);
  const ok = Boolean(json?.ok ?? (status >= 200 && status < 300));

  return {
    ok: ok && status >= 200 && status < 300,
    status,
    data: json?.data ?? null,
    headers: json?.headers || {},
    error: json?.error || json?.message || null,
    raw: json,
    text
  };
}

export function createXProxyClient(cfg) {
  const endpoint = trimSlash(cfg.COOKMYBOTS_X_ENDPOINT || "");
  const key = String(cfg.COOKMYBOTS_X_KEY || "");

  async function request({ path, method = "GET", query, body, headers } = {}) {
    const finalPath = String(path || "");
    const finalMethod = String(method || "GET").toUpperCase();
    const started = Date.now();

    log.info("xProxy.call.start", {
      method: finalMethod,
      path: finalPath,
      endpointSet: Boolean(endpoint),
      keySet: Boolean(key)
    });

    if (!endpoint || !key) {
      return {
        ok: false,
        status: 412,
        data: null,
        headers: {},
        error: "X proxy is not configured. Set COOKMYBOTS_X_ENDPOINT and COOKMYBOTS_X_KEY."
      };
    }

    try {
      const response = await fetch(endpoint + "/proxy", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: finalPath,
          method: finalMethod,
          query: query || undefined,
          body: finalMethod === "GET" || finalMethod === "HEAD" ? undefined : body,
          headers: headers || undefined
        })
      });

      const text = await response.text().catch(() => "");
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const out = normalizeProxyResponse(response.status, json, text);
      const meta = {
        method: finalMethod,
        path: finalPath,
        status: out.status,
        ms: Date.now() - started,
        retryAfter: out.headers?.retryAfter || out.headers?.["retry-after"] || null,
        rateLimitReset: out.headers?.rateLimitReset || out.headers?.["x-rate-limit-reset"] || null,
        rateLimitRemaining: out.headers?.rateLimitRemaining || out.headers?.["x-rate-limit-remaining"] || null,
        error: out.error || null
      };

      if (out.ok) {
        log.info("xProxy.call.success", meta);
      } else {
        log.warn("xProxy.call.failure", {
          ...meta,
          bodySnippet: cfg.X_LOG_BODY ? bodySnippet(out.raw || out.text) : ""
        });
      }

      return out;
    } catch (err) {
      log.error("xProxy.call.error", {
        method: finalMethod,
        path: finalPath,
        ms: Date.now() - started,
        error: safeErr(err)
      });
      return {
        ok: false,
        status: Number(err?.status || err?.response?.status || 0),
        data: null,
        headers: {},
        error: safeErr(err)
      };
    }
  }

  return {
    request,

    async me() {
      const r = await request({ path: "/2/users/me", method: "GET", query: { "user.fields": "id,name,username" } });
      return { ...r, data: r.data?.data || r.data };
    },

    async userByUsername(username) {
      const clean = String(username || "").replace(/^@/, "").trim();
      if (!clean) return { ok: false, status: 400, data: null, error: "username is required" };
      const r = await request({
        path: "/2/users/by/username/" + encodeURIComponent(clean),
        method: "GET",
        query: { "user.fields": "id,name,username" }
      });
      return { ...r, data: r.data?.data || r.data };
    },

    async followingPage(userId, paginationToken = "") {
      const query = {
        max_results: 1000,
        "user.fields": "id,name,username"
      };
      if (paginationToken) query.pagination_token = paginationToken;

      return await request({
        path: "/2/users/" + encodeURIComponent(String(userId)) + "/following",
        method: "GET",
        query
      });
    },

    async postNotification(text) {
      return await request({
        path: "/2/tweets",
        method: "POST",
        body: { text: String(text || "").slice(0, 280) }
      });
    },

    async dmNotification(targetUserId, text) {
      return await request({
        path: "/2/dm_conversations/with/" + encodeURIComponent(String(targetUserId)) + "/messages",
        method: "POST",
        body: { text: String(text || "").slice(0, 1000) }
      });
    }
  };
}
