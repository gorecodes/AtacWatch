-- ============================================================================
-- 0004_realtime_cron.sql — pg_cron + pg_net per invocare la Edge Function
-- 'ingest-rt' ogni minuto (polling dei feed GTFS-RT).
--
-- PREREQUISITI (una tantum, dal dashboard Supabase):
--   1. Deploy della Edge Function:  supabase functions deploy ingest-rt
--   2. Abilita le estensioni pg_cron e pg_net (Database -> Extensions)
--   3. Salva i segreti nel Vault (Database -> Vault), oppure sostituisci sotto:
--        - 'project_url'      = https://<PROJECT_REF>.supabase.co
--        - 'service_role_key' = <service role key>
--   Esegui poi questo file.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Rimuove eventuale job preesistente con lo stesso nome
select cron.unschedule('ingest-rt-poll')
where exists (select 1 from cron.job where jobname = 'ingest-rt-poll');

-- Job: ogni minuto fa POST alla Edge Function. URL e chiave letti dal Vault.
select cron.schedule(
  'ingest-rt-poll',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/ingest-rt',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
