import { log, safeErr } from "../lib/logger.js";
import { rateLimitBackoffMs } from "../lib/time.js";
import { deliverNotification } from "./notifier.js";

function normalizeUser(user) {
  return {
    id: String(user?.id || ""),
    username: String(user?.username || ""),
    name: String(user?.name || "")
  };
}

function eventKey(targetUserId, changeType, changedUserId, detectedDate) {
  const window = detectedDate.toISOString().slice(0, 16);
  return [targetUserId, changeType, changedUserId, window].join(":");
}

function mapById(users) {
  const out = new Map();
  for (const user of users) {
    if (user?.id) out.set(String(user.id), normalizeUser(user));
  }
  return out;
}

async function safeUpdateMonitoredAccount(db, filter, mutableFields) {
  const doc = { ...mutableFields };
  delete doc._id;
  delete doc.createdAt;

  try {
    await db.collection("monitored_accounts").updateOne(
      filter,
      {
        $setOnInsert: { createdAt: new Date() },
        $set: { ...doc, updatedAt: new Date() }
      },
      { upsert: true }
    );
  } catch (err) {
    log.error("db.write.failed", {
      collection: "monitored_accounts",
      operation: "updateOne",
      error: safeErr(err)
    });
    throw err;
  }
}

async function getSnapshot(db, targetUserId) {
  try {
    return await db.collection("following_snapshots").findOne({ targetUserId: String(targetUserId) });
  } catch (err) {
    log.error("db.read.failed", {
      collection: "following_snapshots",
      operation: "findOne",
      error: safeErr(err)
    });
    throw err;
  }
}

async function saveSnapshot(db, target, users) {
  const followingIds = users.map((user) => String(user.id)).filter(Boolean).sort();
  const followingUsers = users.map(normalizeUser).filter((user) => user.id);

  try {
    await db.collection("following_snapshots").updateOne(
      { targetUserId: String(target.id) },
      {
        $setOnInsert: { },
        $set: {
          targetUserId: String(target.id),
          targetUsername: String(target.username || ""),
          targetName: String(target.name || ""),
          followingIds,
          followingUsers,
          count: followingIds.length,
          capturedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (err) {
    log.error("db.write.failed", {
      collection: "following_snapshots",
      operation: "updateOne",
      error: safeErr(err)
    });
    throw err;
  }
}

async function insertChangeEvent({ db, cfg, x, target, changeType, changedAccount }) {
  const detectedAt = new Date();
  const event = {
    eventKey: eventKey(target.id, changeType, changedAccount.id, detectedAt),
    targetUserId: String(target.id),
    targetUsername: String(target.username || ""),
    targetName: String(target.name || ""),
    changedUserId: String(changedAccount.id),
    changedAccount: normalizeUser(changedAccount),
    changeType,
    detectedAt,
    deliveryStatus: "pending",
    updatedAt: detectedAt
  };

  try {
    const result = await db.collection("following_events").updateOne(
      { eventKey: event.eventKey },
      {
        $setOnInsert: event,
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );

    if (result.upsertedCount === 1) {
      log.info("following.change.detected", {
        eventKey: event.eventKey,
        targetUsername: target.username,
        changeType,
        changedUsername: changedAccount.username || ""
      });
      await deliverNotification({ cfg, db, x, event });
    }
  } catch (err) {
    log.error("db.write.failed", {
      collection: "following_events",
      operation: "updateOne",
      error: safeErr(err)
    });
    throw err;
  }
}

export async function resolveMonitorTarget({ cfg, db, x, authenticatedAccount }) {
  if (cfg.X_MONITORED_USERNAME) {
    const lookup = await x.userByUsername(cfg.X_MONITORED_USERNAME);
    if (!lookup.ok || !lookup.data?.id) {
      log.error("monitor.target.lookup.failed", {
        username: cfg.X_MONITORED_USERNAME,
        status: lookup.status,
        error: lookup.error || "target lookup failed"
      });
      return null;
    }

    const target = normalizeUser(lookup.data);
    await safeUpdateMonitoredAccount(db, { targetUserId: target.id }, {
      targetUserId: target.id,
      username: target.username,
      name: target.name,
      source: "X_MONITORED_USERNAME",
      active: true
    });
    return target;
  }

  if (authenticatedAccount?.id) {
    const target = normalizeUser(authenticatedAccount);
    log.warn("monitor.target.fallback", {
      message: "X_MONITORED_USERNAME is missing. Monitoring the authenticated proxy-managed X account."
    });

    await safeUpdateMonitoredAccount(db, { targetUserId: target.id }, {
      targetUserId: target.id,
      username: target.username,
      name: target.name,
      source: "authenticated_account_fallback",
      active: true
    });
    return target;
  }

  log.error("monitor.target.missing", {
    message: "Set X_MONITORED_USERNAME or connect an X account that supports /2/users/me."
  });
  return null;
}

async function fetchFollowingList({ cfg, db, x, target }) {
  const users = [];
  let nextToken = "";
  let pages = 0;

  do {
    pages += 1;
    await safeUpdateMonitoredAccount(db, { targetUserId: String(target.id) }, {
      pollingCursor: nextToken || "",
      lastScanPage: pages
    });

    const page = await x.followingPage(target.id, nextToken);
    const backoffMs = rateLimitBackoffMs(page);

    if (!page.ok) {
      const err = new Error(page.error || "following list request failed");
      err.status = page.status;
      err.backoffMs = backoffMs;
      throw err;
    }

    const pageUsers = Array.isArray(page.data?.data) ? page.data.data : [];
    users.push(...pageUsers.map(normalizeUser).filter((user) => user.id));
    nextToken = String(page.data?.meta?.next_token || "");

    log.info("following.page", {
      targetUserId: target.id,
      page: pages,
      count: pageUsers.length,
      hasNext: Boolean(nextToken)
    });
  } while (nextToken && pages < cfg.MAX_FOLLOWING_PAGES_PER_SCAN);

  if (nextToken) {
    const err = new Error("Following scan stopped before completion because MAX_FOLLOWING_PAGES_PER_SCAN was reached. Snapshot was not updated.");
    err.status = 429;
    err.backoffMs = 10 * 60_000;
    throw err;
  }

  return users;
}

export async function runFollowingScan({ cfg, db, x, target }) {
  const startedAt = new Date();
  await safeUpdateMonitoredAccount(db, { targetUserId: String(target.id) }, {
    targetUserId: String(target.id),
    username: String(target.username || ""),
    name: String(target.name || ""),
    scanStatus: "running",
    lastScanStartedAt: startedAt
  });

  try {
    const latestUsers = await fetchFollowingList({ cfg, db, x, target });
    const previous = await getSnapshot(db, target.id);

    if (!previous) {
      await saveSnapshot(db, target, latestUsers);
      await safeUpdateMonitoredAccount(db, { targetUserId: String(target.id) }, {
        baselineComplete: true,
        followingCount: latestUsers.length,
        scanStatus: "ok",
        pollingCursor: "",
        lastSuccessfulScanAt: new Date(),
        lastError: ""
      });

      log.info("following.baseline.created", {
        targetUserId: target.id,
        targetUsername: target.username,
        followingCount: latestUsers.length
      });

      return { changes: 0, backoffMs: 0 };
    }

    const oldIds = new Set(Array.isArray(previous.followingIds) ? previous.followingIds.map(String) : []);
    const latestIds = new Set(latestUsers.map((user) => String(user.id)));
    const oldUsers = mapById(Array.isArray(previous.followingUsers) ? previous.followingUsers : []);
    const latestUsersById = mapById(latestUsers);

    const followed = [];
    const unfollowed = [];

    for (const id of latestIds) {
      if (!oldIds.has(id)) followed.push(latestUsersById.get(id));
    }

    for (const id of oldIds) {
      if (!latestIds.has(id)) unfollowed.push(oldUsers.get(id) || { id, username: "", name: "" });
    }

    log.info("following.diff", {
      targetUserId: target.id,
      targetUsername: target.username,
      followed: followed.length,
      unfollowed: unfollowed.length
    });

    for (const account of followed) {
      await insertChangeEvent({ db, cfg, x, target, changeType: "follow", changedAccount: account });
    }

    for (const account of unfollowed) {
      await insertChangeEvent({ db, cfg, x, target, changeType: "unfollow", changedAccount: account });
    }

    await saveSnapshot(db, target, latestUsers);
    await safeUpdateMonitoredAccount(db, { targetUserId: String(target.id) }, {
      baselineComplete: true,
      followingCount: latestUsers.length,
      scanStatus: "ok",
      pollingCursor: "",
      lastSuccessfulScanAt: new Date(),
      lastError: ""
    });

    return { changes: followed.length + unfollowed.length, backoffMs: 0 };
  } catch (err) {
    await safeUpdateMonitoredAccount(db, { targetUserId: String(target.id) }, {
      scanStatus: "failed",
      lastFailedScanAt: new Date(),
      lastError: safeErr(err)
    });

    log.error("following.scan.failed", {
      targetUserId: target.id,
      targetUsername: target.username,
      status: err?.status || 0,
      error: safeErr(err)
    });

    return { changes: 0, backoffMs: err?.backoffMs || 0 };
  }
}
