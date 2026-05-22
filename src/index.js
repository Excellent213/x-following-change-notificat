import "dotenv/config";
import { loadConfig } from "./lib/config.js";
import { log, safeErr } from "./lib/logger.js";

process.on("unhandledRejection", (err) => {
  log.error("process.unhandledRejection", { error: safeErr(err) });
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  log.error("process.uncaughtException", { error: safeErr(err) });
  process.exit(1);
});

async function boot() {
  try {
    log.info("boot.start", { platform: "x" });

    const [{ connectDb }, { createXProxyClient }, { startBot }] = await Promise.all([
      import("./lib/db.js"),
      import("./services/xProxy.js"),
      import("./bot.js")
    ]);

    const cfg = loadConfig();

    log.info("boot.config", {
      mongodbUriSet: Boolean(cfg.MONGODB_URI),
      xEndpointSet: Boolean(cfg.COOKMYBOTS_X_ENDPOINT),
      xKeySet: Boolean(cfg.COOKMYBOTS_X_KEY),
      monitoredUsernameSet: Boolean(cfg.X_MONITORED_USERNAME),
      notificationMode: cfg.X_NOTIFICATION_MODE,
      dmTargetSet: Boolean(cfg.X_NOTIFICATION_TARGET_USER_ID),
      pollIntervalMs: cfg.X_POLL_INTERVAL_MS
    });

    if (!cfg.MONGODB_URI) {
      log.error("boot.config.missing", { key: "MONGODB_URI" });
      process.exit(1);
    }

    if (!cfg.COOKMYBOTS_X_ENDPOINT || !cfg.COOKMYBOTS_X_KEY) {
      log.error("boot.config.missing", {
        message: "COOKMYBOTS_X_ENDPOINT and COOKMYBOTS_X_KEY are required for X proxy access."
      });
      process.exit(1);
    }

    const db = await connectDb(cfg.MONGODB_URI);
    const x = createXProxyClient(cfg);

    const health = await x.me();
    if (!health.ok || !health.data?.id) {
      log.error("boot.xHealth.failed", {
        status: health.status,
        error: health.error || "X proxy current-account lookup failed"
      });
      process.exit(1);
    }

    log.info("boot.xHealth.ok", {
      authenticatedUserId: health.data.id,
      authenticatedUsername: health.data.username || ""
    });

    await startBot({ cfg, db, x, authenticatedAccount: health.data });
  } catch (err) {
    log.error("boot.failed", {
      error: safeErr(err),
      hint: "Check dependencies, env vars, MongoDB connectivity, and relative import paths."
    });
    process.exit(1);
  }
}

boot();
