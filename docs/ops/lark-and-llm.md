# Runbook: Lark delivery and the LLM endpoint

Status: Lark posts through a group's custom-bot webhook until the Ideas Hub bot app exists (ADR 0004
"Lark"). Every variable below lives in `.env` (never committed; names only in `.env.example`).

## Lark: custom-bot webhook (temporary)

Used only while `LARK_APP_ID` and `LARK_APP_SECRET` are empty.

| Variable | Value |
| --- | --- |
| `LARK_WEBHOOK_URL` | The group's custom-bot webhook (Lark group settings → Bots → Custom bot → Webhook) |
| `LARK_WEBHOOK_SECRET` | Optional: the bot's signature key, when "Signature verification" is on |

- Every post goes to that one group: the global briefing, each store's keyword briefing (one post per
  store chat set in `stores.lark_chat_id`) and the watchdog's Alerts. `LARK_SHARED_CHAT_ID` and
  `LARK_ADMIN_CHAT_ID` are not read; posts are recorded under the chat `webhook`.
- A custom bot returns no message id, so `lark_messages.message_id` and `alerts.lark_message_id` get
  `webhook:<uuid>`, the uuid being the one the bot app would send. A reply with a `code` other than 0
  (for example 11232, rate limited; 19021, bad signature; 9499, bad request) is a failed post, retried by
  `lark.send` like a bot app error.
- Lark does not dedupe webhook posts. A worker that dies after Lark accepted a post but before the row
  got its id posts it again on the retry.
- Limits: 5 posts a second and 100 a minute per bot; each process waits for a free slot. Lark advises
  avoiding the full and half hour; the default briefing (06:30) is posted after its build, a few minutes
  later.
- The webhook URL carries the bot's token: it is never logged, and error messages leave it out.

Check: `pnpm --filter @ideas-hub/worker exec tsx` a script that calls
`larkClientFor(larkConfigFromEnv()!).post('webhook', larkUuid('test', '<date>'), '<text>', signal)` and
prints the returned id; a failed post throws `Lark webhook failed: HTTP <status>, code <code>, <msg>`.

## Lark: back to the bot app

1. Create the bot app, add it to the shared group and the admin chat, note their chat ids.
2. Set `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_SHARED_CHAT_ID` and `LARK_ADMIN_CHAT_ID` (and
   `LARK_BASE_URL` if not `https://open.larksuite.com`). The bot app wins as soon as the id and secret are
   set; `LARK_WEBHOOK_URL` can stay or go.
3. Restart the worker task; the watchdog reads the environment on each run.
4. Posts from then on carry Lark's `uuid` dedupe and a real message id. Rows already written under the
   chat `webhook` keep their `webhook:<uuid>` id and are not posted again. Switch outside 06:30–07:00:
   `lark.send` jobs queued before the restart carry the chat `webhook`, and the bot app would send them to
   a chat id that does not exist; the watchdog then writes `lark_send_failed` for the global briefing.
