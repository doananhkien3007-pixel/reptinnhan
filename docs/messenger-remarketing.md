# Messenger remarketing

The feature is installed disabled and targets product `16` (`P-1793464317378-2XP8U`) only. Ads that map to the same product share one customer cycle. A customer can have at most one active cycle.

Approved copy (kept as one Messenger message):

```text
Chị ưng mẫu nào không ạ ?
Chị gửi em chiều cao + cân nặng, em chọn size vừa đẹp cho mình nha 🥰
```

## Default behavior

- Step 1 is due two hours after a completed introduction.
- `max_steps` defaults to `1`. Step 2 can be enabled explicitly and is due 18 hours after the customer's last valid interaction.
- Quiet hours are 21:00–08:00 in `Asia/Ho_Chi_Minh`. A due time is moved to 08:00 only when that remains inside the safe messaging window.
- The safe window closes 10 minutes before 24 hours. Bot messages, echoes and seen events never extend it.
- No old conversation is backfilled. Enabling or switching from dry-run to production sets a new rollout timestamp and cancels previously queued dry-run cycles.

The cycle is cancelled when the customer writes again, supplies measurements, declines, an external/manual outbound echo appears, the conversation enters standby, an order is created, the product changes or becomes inactive, or either bot/remarketing is disabled.

## Delivery safety

Database functions atomically claim each step with a 45-second lease and a unique attempt key. A timed-out lease becomes `uncertain` and is never retried automatically. Only an explicit HTTP 429 is retried once; network errors, timeouts and 5xx responses become `uncertain` to avoid duplicates.

Every bot send contains a random `leafchat:<uuid>` Messenger metadata marker registered before the request. Echo webhooks with a matching marker are recognized as this bot; unmatched echoes cancel the cycle as external outbound activity without assuming that every echo is a human.

## Activation order

1. Apply the migration. It enables `pg_cron` and `pg_net` but creates no schedule; config remains disabled and dry-run.
2. Deploy the endpoint with `MESSENGER_REMARKETING_AVAILABLE=true` and a random `REMARKETING_CRON_SECRET` of at least 32 characters.
3. Put the verified endpoint URL and the same secret into Supabase Vault. Do not store either in SQL or logs.
4. Enable dry-run in the Inbox settings and call the endpoint manually. Confirm it returns `mode: dry_run` and sends no Graph API request.
5. Only on hosting whose terms permit this commercial use, install `sql/messenger_remarketing_cron.sql`, observe the HTTP response, and then enable production.

Vercel Hobby's terms restrict it to personal/non-commercial use. The external Supabase cron changes scheduling precision, not the Vercel plan's usage terms.
