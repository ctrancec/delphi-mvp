/**
 * The SQL that wakes the engine every fifteen minutes from Supabase's own
 * cron (pg_cron and pg_net), shown on the timing page for the CHO to paste.
 *
 * Built from the engine's address alone. The secret the engine checks never
 * passes through here: the CHO puts it into Supabase Vault by hand, and the
 * job reads it from there at each call.
 */

/** The job's name in Supabase, so it can be checked and undone by name. */
export const TIMING_JOB = 'tempest-engine';
/** Where the job finds the secret, in Vault. */
export const VAULT_NAME = 'tempest_cron_secret';

/** Each step's SQL, for an engine at `url`. Nothing secret goes in. */
export function timingSql(url: string) {
    return {
        enable: `create extension if not exists pg_cron;
create extension if not exists pg_net;`,
        vault: `-- Paste the same value as CRON_SECRET in Vercel in place of the placeholder.
-- It stays in your Supabase project's Vault.
select vault.create_secret('PASTE-YOUR-CRON_SECRET-HERE', '${VAULT_NAME}', 'What the Tempest engine checks');`,
        schedule: `select cron.schedule(
  '${TIMING_JOB}',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := '${url}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${VAULT_NAME}')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);`,
        check: `-- The job's last runs:
select status, return_message, start_time from cron.job_run_details
order by start_time desc limit 5;

-- What the engine answered (200 is good; 401 means the secret does not match):
select status_code, timed_out, error_msg, created from net._http_response
order by created desc limit 5;`,
        undo: `select cron.unschedule('${TIMING_JOB}');`,
    };
}
