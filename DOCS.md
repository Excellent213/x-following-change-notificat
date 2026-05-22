# Following Watch Bot

## What it does

Following Watch Bot monitors the following list of one configured X account. It stores a first baseline snapshot in MongoDB, then sends notifications when the account follows or unfollows other accounts.

The bot uses X only. All X reads and writes go through the CookMyBots X Proxy. It never calls X APIs directly and never manages OAuth tokens.

## Public features

### Following monitor

What it does: polls the monitored account following list, detects new follows and unfollows, records each change in MongoDB, and sends a notification.

Required parameters: configure `X_MONITORED_USERNAME` when you want to monitor a specific account. If omitted, the bot tries to monitor the authenticated proxy-managed X account from `/2/users/me`.

Output: a concise X post by default, or a DM when `X_NOTIFICATION_MODE=dm` and `X_NOTIFICATION_TARGET_USER_ID` is set.

There are no chat commands in this project. It is a scheduled monitoring bot.

## Environment variables

`COOKMYBOTS_X_ENDPOINT` is required. It is the base endpoint for the CookMyBots X Proxy.

`COOKMYBOTS_X_KEY` is required and secret. It authenticates proxy calls.

`MONGODB_URI` is required. It stores snapshots, polling state, and change events.

`X_MONITORED_USERNAME` is optional. Set it to the account handle to monitor, without or with `@`.

`X_POLL_INTERVAL_MS` is optional. Default is `300000` ms. Values below five minutes are clamped to five minutes for cost and rate-limit safety.

`X_NOTIFICATION_MODE` is optional. Use `post` for public status/update notifications, or `dm` for direct messages.

`X_NOTIFICATION_TARGET_USER_ID` is optional. Required only when `X_NOTIFICATION_MODE=dm`.

`X_DEBUG` is optional. Set to `1` for extra diagnostic logs.

`X_LOG_BODY` is optional. Set to `1` to include small failed-response snippets in logs. Secrets are never logged.

## Notification modes

`post` is the default. The bot posts a short status/update from the authenticated bot account.

`dm` sends a DM through the X proxy. If `X_NOTIFICATION_TARGET_USER_ID` is missing, delivery is skipped and logged without crashing.

## MongoDB collections

`monitored_accounts` stores the resolved target account, scan status, cursors, and latest scan timestamps.

`following_snapshots` stores the latest complete following snapshot for the target account.

`following_events` stores detected follow and unfollow events plus delivery status.

`bot_state` is reserved for small persistent runtime state.

Indexes are created on application fields only. The bot never creates an `_id` index.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.sample` to `.env`.
3. Fill in `MONGODB_URI`, `COOKMYBOTS_X_ENDPOINT`, and `COOKMYBOTS_X_KEY`.
4. Optionally set `X_MONITORED_USERNAME`.
5. Run locally with `npm run dev`.
6. Run in production with `npm start`.

## Deployment

Deploy as one Node.js service. Use the build command `npm run build` and start command `npm start`.

Required deploy environment variables are `MONGODB_URI`, `COOKMYBOTS_X_ENDPOINT`, and `COOKMYBOTS_X_KEY`.

## Troubleshooting

If startup exits, check that MongoDB and X proxy env vars are set. Logs print only booleans for secret presence.

If no target account is configured, the bot will try the authenticated proxy account. If that lookup fails, it logs a clear error and stays alive.

If no notifications appear after first run, that is expected. The first successful scan creates a baseline and does not send historical alerts.

If scans fail with 429 or daily-limit errors, the bot backs off and continues later.
