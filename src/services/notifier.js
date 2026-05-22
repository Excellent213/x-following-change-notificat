import { log, safeErr } from "../lib/logger.js";

function displayAccount(account) {
  const username = account?.username ? "@" + account.username : "unknown handle";
  const name = account?.name ? account.name + " " : "";
  return name + "(" + username + ")";
}

export function formatNotification(event) {
  const verb = event.changeType === "follow" ? "followed" : "unfollowed";
  const timestamp = new Date(event.detectedAt || Date.now()).toISOString();

  return [
    "Following Watch alert:",
    "@" + event.targetUsername + " " + verb + " " + displayAccount(event.changedAccount) + ".",
    "Detected: " + timestamp
  ].join("\n");
}

export async function deliverNotification({ cfg, db, x, event }) {
  const text = formatNotification(event);
  const events = db.collection("following_events");
  const now = new Date();

  log.info("notification.attempt", {
    eventKey: event.eventKey,
    mode: cfg.X_NOTIFICATION_MODE,
    dmTargetSet: Boolean(cfg.X_NOTIFICATION_TARGET_USER_ID)
  });

  try {
    let result;

    if (cfg.X_NOTIFICATION_MODE === "dm") {
      if (!cfg.X_NOTIFICATION_TARGET_USER_ID) {
        log.warn("notification.dm.disabled", {
          eventKey: event.eventKey,
          reason: "X_NOTIFICATION_TARGET_USER_ID is missing"
        });

        await events.updateOne(
          { eventKey: event.eventKey },
          {
            $set: {
              deliveryStatus: "skipped",
              deliveryMode: "dm",
              deliveryError: "DM delivery disabled because X_NOTIFICATION_TARGET_USER_ID is missing.",
              updatedAt: now
            }
          }
        );
        return;
      }

      result = await x.dmNotification(cfg.X_NOTIFICATION_TARGET_USER_ID, text);
    } else {
      result = await x.postNotification(text);
    }

    if (!result.ok) {
      await events.updateOne(
        { eventKey: event.eventKey },
        {
          $set: {
            deliveryStatus: "failed",
            deliveryMode: cfg.X_NOTIFICATION_MODE,
            deliveryError: result.error || "X proxy delivery failed",
            deliveryStatusCode: result.status || 0,
            updatedAt: now
          }
        }
      );

      log.error("notification.failure", {
        eventKey: event.eventKey,
        status: result.status,
        error: result.error || "X proxy delivery failed"
      });
      return;
    }

    await events.updateOne(
      { eventKey: event.eventKey },
      {
        $set: {
          deliveryStatus: "sent",
          deliveryMode: cfg.X_NOTIFICATION_MODE,
          deliveredAt: now,
          deliveryStatusCode: result.status || 200,
          updatedAt: now
        }
      }
    );

    log.info("notification.success", {
      eventKey: event.eventKey,
      mode: cfg.X_NOTIFICATION_MODE,
      status: result.status
    });
  } catch (err) {
    log.error("notification.error", {
      eventKey: event.eventKey,
      error: safeErr(err)
    });

    await events.updateOne(
      { eventKey: event.eventKey },
      {
        $set: {
          deliveryStatus: "failed",
          deliveryError: safeErr(err),
          updatedAt: now
        }
      }
    );
  }
}
