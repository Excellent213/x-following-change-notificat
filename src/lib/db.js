import { MongoClient } from "mongodb";
import { log, safeErr } from "./logger.js";

let client = null;
let db = null;

export async function connectDb(mongoUri) {
  if (db) return db;

  try {
    client = new MongoClient(mongoUri || "", {
      maxPoolSize: 5,
      ignoreUndefined: true
    });

    await client.connect();
    db = client.db();
    await ensureIndexes(db);

    log.info("db.connect.ok", { mongodbUriSet: Boolean(mongoUri) });
    return db;
  } catch (err) {
    log.error("db.connect.failed", {
      collection: "n/a",
      operation: "connect",
      error: safeErr(err)
    });
    throw err;
  }
}

export function getDb() {
  if (!db) throw new Error("Database is not connected yet.");
  return db;
}

async function ensureIndexes(database) {
  try {
    await database.collection("monitored_accounts").createIndex({ targetUserId: 1 }, { unique: true });
    await database.collection("monitored_accounts").createIndex({ username: 1 });
    await database.collection("following_snapshots").createIndex({ targetUserId: 1 }, { unique: true });
    await database.collection("following_events").createIndex({ eventKey: 1 }, { unique: true });
    await database.collection("following_events").createIndex({ targetUserId: 1, detectedAt: -1 });
    await database.collection("following_events").createIndex({ deliveryStatus: 1, detectedAt: 1 });
    await database.collection("bot_state").createIndex({ key: 1 }, { unique: true });

    log.info("db.indexes.ok", {
      collections: ["monitored_accounts", "following_snapshots", "following_events", "bot_state"]
    });
  } catch (err) {
    log.error("db.indexes.failed", {
      collection: "multiple",
      operation: "ensureIndexes",
      error: safeErr(err)
    });
    throw err;
  }
}

export async function closeDb() {
  if (client) await client.close();
  client = null;
  db = null;
}
