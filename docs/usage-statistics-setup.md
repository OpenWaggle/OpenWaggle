# Usage statistics setup

This runbook connects the usage-statistics feature (ADR 0044, 0045, 0046) to real accounts. The code ships with no keys: the app only talks to `https://openwaggle.ai/api/v1/`, and every vendor credential lives in the Cloudflare Pages project. Until these steps are done, the endpoint stores or drops reports and forwards nothing.

Do the steps in order. Steps 1, 2 and 8 are release blockers: statistics are on by default, so the privacy notice must be complete before a release that contains the feature.

## 1. Finish the privacy notice

1. Fill in the placeholders in `website/src/content/docs/configuration/usage-statistics.md`. `rg -n '\[TODO' website/src/content/docs` lists them:
   - the controller's full legal name;
   - the PostHog retention period (step 3);
   - the Sentry retention period (step 4);
   - the retention of Cloudflare security events on your plan (step 5).
2. Create the mailbox `privacy@openwaggle.ai` and make sure someone reads it.
3. Have the notice and the ePrivacy position reviewed (ADR 0046). Ask the reviewer whether Article 27 requires an EU representative for your country of residence.

## 2. Processing agreements

Accept the data processing agreement of each processor before you send it data, and keep a copy:
- Cloudflare: its Data Processing Addendum, which forms part of the self-serve subscription terms. Download a copy from Cloudflare's Trust Hub for your records.
- PostHog: its DPA (<https://posthog.com/dpa>), signed for your organization.
- Sentry: its DPA (<https://sentry.io/legal/dpa/>), accepted for your organization.

## 3. PostHog (statistics dashboard)

1. Sign up at <https://eu.posthog.com>. The EU region is required: the endpoint refuses any other host.
2. Create a project named `OpenWaggle`.
3. In **Project settings**:
   - Turn on **Discard client IP data**. Every event the endpoint sends is already personless (`$process_person_profile: false`) and has GeoIP disabled.
   - Leave the web snippet and session replay unused. The site has its own beacon.
4. In **Organization settings > Billing**, set a billing limit so abuse cannot run up costs.
5. Note your plan's data retention for the notice (step 1).
6. Copy the **Project API key** (`phc_...`) for step 5.

Reading the data: app statistics arrive once a day, after the flush, as one event per original event name, for example `install.active` or `run.finished`. The properties are `field`, `value` and `count`; integer fields carry `sum` and `count` instead. Some example insights:
- **Daily active installs:** Trends, event `install.active`, filter `field = _count`, aggregate by the property sum of `count`.
- **Weekly or monthly actives:** the same, with `field = first_this_week` (or `first_this_month`) and `value = true`.
- **Feature adoption:** event `install.active`, filter `field = terminal` (any feature flag) and `value = true`.
- **Model mix:** event `run.finished`, filter `field = model`, broken down by `value`.

A value counted by fewer than 5 installs that day appears as `(other)`, and a whole breakdown is dropped when `(other)`, or the group of installs that lack a value, would stand for 1 to 4 reports. While OpenWaggle has a handful of installs, expect mostly totals; breakdowns appear as more installs report. The threshold is `MIN_CONTRIBUTING_ENTRIES` in `functions/_lib/flush-totals.ts`. Lowering it is a privacy decision recorded in ADR 0044, so change the ADR and the privacy notice with it.

Other events in the same project:
- `github.download`, `github.traffic`, `github.referrer`, `npm.downloads`: the daily snapshot.
- `$pageview`, `download_click`: openwaggle.ai, without cookies.
- `endpoint.request`, `endpoint.requests`: endpoint health.

## 4. Sentry (error reports)

1. Create the organization in Sentry's **EU (Germany)** data region. The endpoint accepts only DSNs on `*.de.sentry.io`.
2. Create a project with the **Electron** platform, named `openwaggle`.
3. In **Project settings > Security & Privacy**:
   - Turn on **Prevent storing of IP addresses**.
   - Keep **Data scrubber** and **Use default scrubbers** on.
4. In the subscription settings, keep the pay-as-you-go budget at zero (or a small cap) so a burst of reports cannot create costs.
5. Note the retention your plan gives errors, for the notice (step 1).
6. Copy the DSN from **Client Keys (DSN)**. It must look like `https://<key>@o<org>.ingest.de.sentry.io/<project>`. You need it in step 5.
7. Optional, later: upload source maps from the release workflow so renderer stack traces are readable. That needs `SENTRY_AUTH_TOKEN` in GitHub and a release-workflow change, which is not part of this feature.

## 5. Cloudflare (the endpoint)

The endpoint is the Pages Function in `functions/`, deployed with the website by the `openwaggle-website` Pages project (`wrangler.toml`).

1. Create the KV namespace:
   ```bash
   npx wrangler kv namespace create STATS_KV
   ```
2. In `wrangler.toml`, uncomment the `[[kv_namespaces]]` block, paste the printed `id`, and merge that change. When `wrangler.toml` declares `pages_build_output_dir`, Cloudflare reads bindings from the file and does not let you add them in the dashboard.
3. Generate the job token:
   ```bash
   openssl rand -hex 32
   ```
   Keep the value; you need it again in step 6.
4. Set the three secrets, from the dashboard (**Workers & Pages > openwaggle-website > Settings > Variables and Secrets**, type Secret) or from a terminal:
   ```bash
   npx wrangler pages secret put POSTHOG_PROJECT_KEY --project-name openwaggle-website
   npx wrangler pages secret put SENTRY_DSN --project-name openwaggle-website
   npx wrangler pages secret put STATS_SNAPSHOT_TOKEN --project-name openwaggle-website
   ```
   `POSTHOG_HOST` is optional, and its only accepted value is the default, `https://eu.i.posthog.com`.
5. Keep persistent request logging off for this project. Leave **Workers Logs** and **Logpush** off; the live tail (`npx wrangler pages deployment tail`) is enough to debug.
6. Add a rate-limiting rule under **Security > WAF > Rate limiting rules**:
   - Match: `URI Path starts with /api/v1/`.
   - Limit: on the Free plan the period and block duration are fixed at 10 seconds, so use for example 20 requests per 10 seconds per IP with a 10-second block. Paid plans allow longer periods.
   The rule processes client IP addresses for abuse protection, and Cloudflare lists blocked requests in **Security > Events**. The privacy notice already discloses this; keep it that way if you change the rule.
7. Check the KV limits for your plan. On the free plan, writes per day are limited, and each app report costs one write plus a delete at flush time. Move to Workers Paid when the install base grows.
8. Deploy the website as you do today. A Git-connected Pages project redeploys on merge. Otherwise, run `pnpm website:build` and then `npx wrangler pages deploy`.

## 6. GitHub (the daily snapshot and flush)

1. In **Settings > Secrets and variables > Actions**, add these repository secrets:
   - `STATS_SNAPSHOT_TOKEN`: the same value as the Pages secret.
   - `STATS_GITHUB_TOKEN` (optional): a fine-grained personal access token for `OpenWaggle/OpenWaggle` with **Administration: Read**, used only for repository traffic, which GitHub keeps for 14 days. Without it the job skips traffic. Set a reminder for its expiry.
2. Run the workflow once by hand: **Actions > Usage Statistics Snapshot > Run workflow**. It records the release baseline, then flushes buffered app statistics. After that it runs daily at 05:23 UTC.

## 7. Google Search Console (search terms)

1. Add the domain property `openwaggle.ai` at <https://search.google.com/search-console> and verify it with the DNS TXT record in Cloudflare.
2. Submit `https://openwaggle.ai/sitemap-index.xml`.

## 8. Verify before release

1. **Endpoint health.** Run `npx wrangler pages deployment tail --project-name openwaggle-website` and load openwaggle.ai in a browser without Do Not Track. You should see a `/api/v1/web` line with outcome `accepted`, and a `$pageview` in PostHog within a minute.
2. **App statistics.** Install a release build, use it for a day, and wait for the next 05:23 UTC run. A flush publishes a day once at least 5 reports of it are buffered, or once it is 7 days old. A single test install therefore appears in PostHog after about a week, as totals only.
3. **Error reports.** In Sentry, check that events have no IP address, no message text (only type and code), and file paths such as `~/...` or `<external>`.
4. **Turning statistics off.** In the app, switch off **Settings > General > Share anonymous usage statistics and error reports**. Check that nothing more reaches `/api/v1/events` from that install.

## Changing vendors later

The app never talks to PostHog or Sentry directly (ADR 0045). To move to another project or vendor, first update the recipients table and the ADRs, then change the Pages secrets, or the forwarding code in `functions/_lib/`, and redeploy the website. No app release is needed.
