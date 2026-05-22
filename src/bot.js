import { log, safeErr } from "./lib/logger.js";
import { sleep } from "./lib/time.js";
import { runFollowingScan, resolveMonitorTarget } from "./services/followingMonitor.js";

export async function startBot({ cfg, db, x, authenticatedAccount }) {
  log.info("bot.start", {
    purpose: "Monitor an X account following list and notify on follow or unfollow changes.",
    features: ["baseline following snapshot", "follow change detection", "unfollow change detection", "post notifications", "optional DM notifications"],
    rules: ["X proxy only", "MongoDB persistence required", "first scan never sends historical alerts", "single non-overlapping polling loop"]
  });

  let target = await resolveMonitorTarget({ cfg, db, x, authenticatedAccount });
  let backoffMs = 0;
  let inFlight = false;
  let cycles = 0;
  let lastMemLogAt = 0;

  log.info("poll.start", {
    stream: "following",
    intervalMs: cfg.X_POLL_INTERVAL_MS,
    targetResolved: Boolean(target?.id)
  });

  while (true) {
    const cycleStartedAt = Date.now();
    cycles += 1;

    if (Date.now() - lastMemLogAt > 60_000) {
      const m = process.memoryUsage();
      log.info("mem", {
        rssMB: Math.round(m.rss / 1e6),
        heapUsedMB: Math.round(m.heapUsed / 1e6)
      });
      lastMemLogAt = Date.now();
    }

    if (inFlight) {
      log.warn("poll.skipped", {
        stream: "following",
        reason: "previous cycle still running"
      });
      await sleep(cfg.X_POLL_INTERVAL_MS);
      continue;
    }

    inFlight = true;
    log.info("poll.cycle", {
      stream: "following",
      cycle: cycles,
      targetUserId: target?.id || "",
      targetUsername: target?.username || ""
    });

    try {
      if (!target?.id) {
        log.warn("poll.noTarget", {
          message: "No monitored account is configured or resolvable. The process will stay alive and retry."
        });
        target = await resolveMonitorTarget({ cfg, db, x, authenticatedAccount });
      }

      if (target?.id) {
        const result = await runFollowingScan({ cfg, db, x, target });
        backoffMs = result.backoffMs || 0;
      }
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      log.error("poll.failure", {
        stream: "following",
        status,
        error: safeErr(err)
      });

      if (status === 402 || status === 429 || err?.code === "X_GATEWAY_RATE_LIMITED" || err?.code === "X_GATEWAY_DAILY_LIMITED") {
        backoffMs = Math.max(backoffMs || 0, 10 * 60 * 1000);
      } else {
        backoffMs = Math.max(backoffMs || 0, 30_000);
      }
    } finally {
      inFlight = false;
      log.info("poll.cycle.end", {
        stream: "following",
        ms: Date.now() - cycleStartedAt
      });
    }

    if (backoffMs > 0) {
      log.warn("poll.backoff", {
        stream: "following",
        backoffMs
      });
      await sleep(backoffMs);
      backoffMs = 0;
    }

    await sleep(cfg.X_POLL_INTERVAL_MS);
  }
}
