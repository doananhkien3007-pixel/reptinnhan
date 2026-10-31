-- Run only after /api/remarketing has been deployed and its authenticated
-- dry-run response has been verified. Never paste secret values into this file.
-- Required Vault secret names:
--   messenger_remarketing_endpoint_url = full HTTPS endpoint URL
--   messenger_remarketing_cron_secret  = same 32+ char server secret on Vercel

select cron.schedule(
  'messenger-remarketing-every-5-minutes',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
        where name = 'messenger_remarketing_endpoint_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
          where name = 'messenger_remarketing_cron_secret')
      ),
      body := jsonb_build_object('source', 'supabase_cron'),
      timeout_milliseconds := 20000
    );
  $job$
);

select cron.schedule(
  'messenger-remarketing-cleanup-daily',
  '17 18 * * *',
  $job$
    select public.remarketing_cleanup();
    delete from cron.job_run_details where end_time < now() - interval '14 days';
  $job$
);

-- Emergency stop (does not delete data):
-- select public.remarketing_update_config(false, true, 1);
-- select cron.unschedule('messenger-remarketing-every-5-minutes');
