---
status: proposed
---

# Usage statistics go through an OpenWaggle endpoint

The app sends **Usage statistics**, and any error reports, only to an endpoint OpenWaggle controls, `https://openwaggle.ai/api/v1/`, never directly to an analytics vendor. The endpoint is a Cloudflare Pages Function deployed with the website. It drops the IP address, rejects any field outside the published list, replaces identifiers outside the public catalogs with `custom`, and stores each accepted request only in a short-lived buffer. A daily, authenticated flush run by the snapshot workflow aggregates the buffer into per-day counts and forwards those counts to PostHog's EU region, which is the dashboard for statistics. The daily GitHub and npm snapshot and openwaggle.ai page views, recorded without cookies, report to the same PostHog project. Error reports go to Sentry's EU region through the same endpoint, using the Sentry SDK's `tunnel` option, so the endpoint can drop the IP and reject reports that fail scrubbing before Sentry receives them. The endpoint holds the PostHog project key and the real Sentry DSN; the app ships neither, so turning either service on, off or over to another project needs no app release. Released apps keep the endpoint for as long as they run, so the vendor behind it can change without an app update, and the privacy guarantees of ADR 0044 hold no matter what the vendor stores by default.

## Considered options

- Sending straight to PostHog from the app would remove the endpoint, but every user's IP would reach PostHog, and changing vendors would need every install to update.
- Cloudflare Web Analytics with Workers Analytics Engine keeps everything on Cloudflare, but Analytics Engine has no dashboard, so a Grafana setup or a custom page would have to be built and run.
- A standalone Worker on `stats.openwaggle.ai` would deploy separately from the website. A Pages Function on the site's own origin needs no extra domain, deploys with the site, and lets the website report without a cross-origin exception in its Content Security Policy.
- PostHog's error tracking would keep errors in the same dashboard. Sentry was chosen for its error grouping, source maps and release tooling, at the cost of a second dashboard.

## Consequences

- The endpoint accepts only requests shaped like the app's own: one day per request and bounded counts per event. It rejects browser requests, and only the EU hosts of PostHog and Sentry are accepted as destinations.
- Error reports can still carry personal data that scrubbing misses, so Sentry runs under its data processing agreement and the privacy notice names it. The SDK reports explicitly captured errors and unhandled errors. Every report keeps only its type, a short code and its scrubbed stack trace; only a handled error the app itself reports as an application error may keep its message, because messages can quote files, commands or model output. Failures before Settings load are dropped, because an unknown setting counts as off. Messages also lose UUIDs, long hexadecimal identifiers and per-user temporary paths. The SDK sends no breadcrumbs, screenshots, local variables or session replays, keeps native crash dumps on the machine, and replaces the home directory with `~` before sending. The endpoint repeats the same scrubbing.
