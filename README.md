# Following Watch Bot

Following Watch Bot is a Node.js ES module X bot that monitors one X account's following list and notifies when that account follows or unfollows other accounts.

## Features

- X-only bot, no other platform frameworks.
- All X API calls go through the CookMyBots X Proxy.
- MongoDB persistence for snapshots, scan state, and notification history.
- First scan creates a baseline without sending a notification flood.
- Non-overlapping polling loop with rate-limit backoff.
- Public post notifications by default, optional DM delivery.

## Architecture

- `src/index.js` boots config, MongoDB, and X proxy health checks.
- `src/bot.js` runs the single polling loop.
- `src/services/xProxy.js` wraps CookMyBots X Proxy calls.
- `src/services/followingMonitor.js` resolves the target account, fetches following pages, compares snapshots, and records events.
- `src/services/notifier.js` formats and sends notifications.
- `src/lib/db.js` manages one shared MongoDB connection and indexes.
- `src/lib/logger.js` provides production-safe structured logs.

## Commands and public actions

This bot has no chat commands. It runs a scheduled following monitor.

Example output:

Following Watch alert:
@target followed Display Name (@handle).
Detected: 2026-05-22T00:00:00.000Z

## Environment

Copy `.env.sample` to `.env` and configure the values.

- `MONGODB_URI`: required MongoDB connection string.
- `COOKMYBOTS_X_ENDPOINT`: required CookMyBots X Proxy endpoint.
- `COOKMYBOTS_X_KEY`: required secret proxy key.
- `X_MONITORED_USERNAME`: optional account handle to monitor.
- `X_POLL_INTERVAL_MS`: optional polling interval, defaults to five minutes.
- `X_NOTIFICATION_MODE`: optional `post` or `dm`, defaults to `post`.
- `X_NOTIFICATION_TARGET_USER_ID`: optional DM target user ID.
- `X_DEBUG`: optional extra logs.
- `X_LOG_BODY`: optional small failed-response snippets.

## Run

sh
npm install
npm run dev


Production:

sh
npm run build
npm start


## Integrations

X integration uses only:

- `POST {COOKMYBOTS_X_ENDPOINT}/proxy`

The bot sends proxy bodies with `path`, `method`, `query`, and `body`. It never calls `api.x.com`, `api.twitter.com`, or `/token`.

## Database

MongoDB collections:

- `monitored_accounts`
- `following_snapshots`
- `following_events`
- `bot_state`

Indexes are created for target user IDs, event keys, delivery status, and state keys. No `_id` index is created manually.

## Deployment

Use one Node.js service process. Do not run a separate worker. On Render or similar platforms, set build command `npm run build` and start command `npm start`.

## Troubleshooting

- Missing X proxy env vars cause a clear startup failure.
- Missing `X_MONITORED_USERNAME` falls back to the authenticated proxy account when possible.
- First scan creates a baseline only.
- Rate limits and proxy failures are logged and backed off.
