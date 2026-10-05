# Usage statistics setup

This runbook connects the usage-statistics feature (ADR 0044, 0045, 0046) to real accounts. The code ships with no keys: the app only talks to `https://openwaggle.ai/api/v1/`, and every vendor credential lives in the Cloudflare Pages project. Until these steps are done, the endpoint stores or drops reports and forwards nothing.

Do the steps in order. Steps 1, 2 and 8 are release blockers: statistics are on by default, so the privacy notice must be complete before a release that contains the feature.

## 1. Finish the privacy notice

1. Fill in the placeholders in `website/src/content/docs/configuration/usage-statistics.md`. `rg -n '\[TODO' website/src/content/docs` lists them:
   - the controller's full legal name;
   - the PostHog retention period (step 3);
   - the Sentry retention period (step 4);
   - the retention of Cloudflare security events on your plan (step 5).
2. Make `privacy@openwaggle.ai` reach someone who reads it. Without a company, a Cloudflare Email Routing forward is enough:
   - In the Cloudflare dashboard, open **Compute > Email Service > Email Routing**. Onboard `openwaggle.ai` if it is not listed.
   - Under **Destination Addresses**, add the project inbox (today `openwaggle@gmail.com`) and click the link in the verification email. Rules stay disabled until it is verified.
   - Under **Routing Rules**, create a rule with **Email pattern** `privacy`, **Action** Send to an email, and the project inbox as destination.
   - Test it from a different account; mail sent from the destination account itself may be dropped.
   Replies go out from the project inbox. Publish only `privacy@openwaggle.ai`, so the inbox behind it can change without touching the notice.
3. Have the notice and the ePrivacy position reviewed (ADR 0046). Ask the reviewer whether Article 27 requires an EU representative for your country of residence.

## 2. Processing agreements

Accept the data processing agreement of each processor before a release sends it real user data, and keep a copy. Sign in the name of whoever is the controller at release: you in person, or the company if one exists by then. A company formed later has to sign its own DPAs, so you can leave this step until the controller is settled, as long as it is done before release.

The agreements:

- Cloudflare: its Data Processing Addendum, which forms part of the self-serve subscription terms. Download a copy from Cloudflare's Trust Hub for your records.
- PostHog: the DPA generated in the app (step 3.5).
- Sentry: its DPA (<https://sentry.io/legal/dpa/>), accepted for your organization.

## 3. PostHog (statistics dashboard)

1. Sign up at <https://eu.posthog.com>. The EU region is required: the endpoint refuses any other host.
2. In the onboarding, choose **I'll pick myself** and select only **Product Analytics**. Skip the rest:
   - Do not run `npx @posthog/wizard`; choose **Skip for now** at the install and data-source steps. Events arrive through the endpoint, never from a PostHog SDK.
   - Turn off autocapture, heatmaps and web vitals, and answer **No, thanks** to Session Replay. None of them would collect anything without the SDK, and the privacy notice does not cover them.
   - Web Analytics expects visitor and session ids that the beacon does not send. Read page views in Product analytics instead.
3. In **Settings > Project**:
   - Rename the project to `OpenWaggle`.
   - Under **IP data capture configuration**, check that **Discard client IP data** is on. It is the default for new EU projects. Every event the endpoint sends is already personless (`$process_person_profile: false`) and has GeoIP disabled.
4. Turn off PostHog AI. It sends project data to third-party model providers that the notice does not list. In **Settings > Organization > General**: under **AI service providers**, switch off **Enable PostHog features that use third-party AI services**; under **Internal AI training**, switch off **Enable AI training on anonymized data**; and do not click **Accept beta terms** under **PostHog Desktop beta terms**. All of these need an organization admin; a project-scoped API key cannot read or change them.
5. Get the DPA (step 2): open <https://app.posthog.com/legal>, click **+ New > Data Processing Agreement (DPA)**, enter the controller's name, click **Send for signature**, and sign the PandaDoc email. Only this generated copy is valid; <https://posthog.com/dpa> is a preview.
6. Choose the plan, and put its retention in the notice (step 1). The free plan keeps events 1 year and stops at its monthly limit, so it cannot bill you. A paid plan keeps them 7 years; if you add a card, set a billing limit on each product in the organization's **Billing** settings.
7. Copy the **project token** (`phc_...`). PostHog treats it as public, but keep it out of the repository; it goes into Cloudflare in step 5.

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
3. In **Organization settings > Security & Privacy**, or per project in **Project settings > Security & Privacy**:
   - Turn on **Prevent storing of IP addresses**.
   - Keep **Data scrubber** and **Use default scrubbers** on.
   An organization-wide setting overrides the project one, so the project switch can stay off when the organization switch is on.
   - Under **Advanced Data Scrubbing**, add the rule `[Remove] [Anything] from [$user.geo.**]`. Sentry derives a location from the sending address even with IP storage off, and here that address is Cloudflare's edge near the user. The rule can take a few minutes to apply. The same rule from a terminal:
     ```bash
     sentry api /projects/<org>/openwaggle/ --method PUT --data '{"relayPiiConfig":"{\"rules\":{\"remove-user-geo\":{\"type\":\"anything\",\"redaction\":{\"method\":\"remove\"}}},\"applications\":{\"$user.geo.**\":[\"remove-user-geo\"]}}"}'
     ```
4. In **Organization settings > General**, turn off **Show Generative AI Features**. Seer would otherwise scan new issues automatically and send them to AI subprocessors that the privacy notice does not list.
5. In the subscription settings, keep the pay-as-you-go budget at zero (or a small cap) so a burst of reports cannot create costs.
6. Note the retention your plan gives errors, for the notice (step 1). A new organization starts on a 14-day trial with 90 days, then drops to the free Developer plan with 30 days unless you pick a paid plan. `sentry api /customers/<org>/` shows the current plan and `retentionDays`.
7. Copy the DSN from **Client Keys (DSN)**. It must look like `https://<key>@o<org>.ingest.de.sentry.io/<project>`. You need it in step 5.
8. Optional, later: upload source maps from the release workflow so renderer stack traces are readable. That needs `SENTRY_AUTH_TOKEN` in GitHub and a release-workflow change, which is not part of this feature.

## 5. Cloudflare (the endpoint)

The endpoint is the Pages Function in `functions/`, deployed with the website by the `openwaggle` Pages project (`wrangler.toml`).

1. Create the KV namespace:
   ```bash
   npx wrangler kv namespace create STATS_KV
   ```
2. In `wrangler.toml`, uncomment the `[[kv_namespaces]]` block, paste the printed `id`, and merge that change. When `wrangler.toml` declares `pages_build_output_dir`, Cloudflare reads bindings from the file and does not let you add them in the dashboard. Done for the current account: the namespace id is in `wrangler.toml`.
3. Generate the job token:
   ```bash
   openssl rand -hex 32
   ```
   Keep the value; you need it again in step 6.
4. Set the three secrets, from the dashboard (**Workers & Pages > openwaggle > Settings > Variables and Secrets**, type Secret) or from a terminal:
   ```bash
   npx wrangler pages secret put POSTHOG_PROJECT_KEY --project-name openwaggle
   npx wrangler pages secret put SENTRY_DSN --project-name openwaggle
   npx wrangler pages secret put STATS_SNAPSHOT_TOKEN --project-name openwaggle
   ```
   `POSTHOG_HOST` is optional, and its only accepted value is the default, `https://eu.i.posthog.com`.
5. Keep persistent request logging off for this project. Pages Functions logs are not stored: they exist only while `npx wrangler pages deployment tail` or the dashboard stream is open, which is enough to debug. Do not add a Logpush job for the project.
6. Add a rate-limiting rule. Wrangler's login cannot write security rules, so this is a dashboard step:
   - Open the zone `openwaggle.ai`, go to **Security rules**, and choose **Create rule > Rate limiting rules**.
   - Rule name: `Statistics endpoint`.
   - Match: field **URI Path**, operator **starts with**, value `/api/v1/`.
   - With the same characteristics: **IP**, the only choice on Free.
   - When rate exceeds: 20 requests per 10 seconds. Free fixes the period at 10 seconds.
   - Then take action: **Block**, duration 10 seconds, also fixed on Free.
   - Click **Deploy**.
   The rule processes client IP addresses for abuse protection, and Cloudflare lists blocked requests under **Analytics > Events** for up to 31 days. The privacy notice already discloses this; keep it that way if you change the rule.
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

1. **Endpoint health.** Run `npx wrangler pages deployment tail --project-name openwaggle` and load openwaggle.ai in a browser without Do Not Track. You should see a `/api/v1/web` line with outcome `accepted`, and a `$pageview` in PostHog within a minute.
2. **App statistics.** Install a release build, use it for a day, and wait for the next 05:23 UTC run. A flush publishes a day once at least 5 reports of it are buffered, or once it is 7 days old. A single test install therefore appears in PostHog after about a week, as totals only.
3. **Error reports.** In Sentry, check that events have no IP address, no message text (only type and code), and file paths such as `~/...` or `<external>`.
4. **Turning statistics off.** In the app, switch off **Settings > General > Share anonymous usage statistics and error reports**. Check that nothing more reaches `/api/v1/events` from that install.

## Changing vendors later

The app never talks to PostHog or Sentry directly (ADR 0045). To move to another project or vendor, first update the recipients table and the ADRs, then change the Pages secrets, or the forwarding code in `functions/_lib/`, and redeploy the website. No app release is needed.
