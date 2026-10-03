# Usage statistics fields

This is the complete list of fields OpenWaggle **Usage statistics** may contain. The machine-readable definition is `src/shared/usage-statistics/contract.ts`; the statistics endpoint at `https://openwaggle.ai/api/v1/events` rejects any field or value not listed there, and this document must change with it. The user-facing privacy notice, `website/src/content/docs/configuration/usage-statistics.md`, must describe exactly this list. Decisions: ADR 0044 (no identifier), ADR 0045 (OpenWaggle endpoint, PostHog and Sentry), ADR 0046 (on by default).

## Sent with every event

| Field | Values |
|---|---|
| `version` | App version |
| `build_channel` | `stable`, `beta`, `rc`, `alpha` (Dev builds never send) |
| `update_channel` | `stable`, `beta`, `alpha` |
| `os` | `darwin`, `win32`, `linux` |
| `arch` | `x64`, `arm64` |
| `day` | UTC date; no time of day |
| `country` | Two-letter country code, added by the endpoint from Cloudflare's request data before it drops the IP; the app never sends it |

## Lifecycle events

| Event | Fields |
|---|---|
| `install.active` | `first_this_week`, `first_this_month`, `install_age` bucket (`0-7d`, `8-30d`, `31-90d`, `91-365d`, `>365d`), `entry_points` (any of `app`, `cli`, `agent`; the endpoint stores the combination as one value in contract order (app, cli, agent), e.g. `app+cli`, `app+agent`, `cli+agent`, `app+cli+agent`) |
| `install.new` | none; sent once, on an install's first report |
| `app.opened` | none |
| `update.installed` | `previous_version` |

The Session Host sends `install.active` at most once per UTC day, only on a day with at least one Run, and never when `CI` is set.

## Run events

| Event | Fields |
|---|---|
| `run.finished` | `entry_point` (`app`, `cli`, `agent`); `provider` and `model` (Pi built-in catalog IDs, otherwise `custom`); `thinking_level` (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`); `access_mode` (`ask-for-approval`, `yolo`); `waggle` (boolean); `result` (`completed`, `failed`, `interrupted`); `duration_s`; `input_tokens`; `output_tokens` |
| `run.compacted` | `mechanism` (`native`, `fallback`) |

## Daily feature flags

Booleans for the day, sent with `install.active`: `worker_session`, `waggle`, `worktree`, `terminal`, `browser_preview`, `browser_agent_driven`, `project_action`, `inline_visualization`, `attachment`, `voice`, `fork_or_handoff`. Plus:

- `mcp_servers`: MCP catalog IDs connected that day, otherwise `custom`
- `skills`: built-in skill names used that day, otherwise `custom`
- `extensions_enabled`: bucket (`0`, `1`, `2-5`, `>5`), no IDs

## Onboarding flags

Computed on the machine and sent once, as `install.onboarding`, after the install's first day ends: `provider_within_first_day`, `run_within_first_day`, `project_within_first_day`.

## Limits

The app bounds what one install sends for one UTC day: at most 20 `app.opened`, 5 `update.installed` and 150 Run events (`run.finished` and `run.compacted` together), and up to 32 entries each in `mcp_servers` and `skills`. A day goes in one request of at most 200 events and 256 KiB; events past a limit are dropped, never sent later. A day older than 35 days is dropped unsent, and each day is sent at most once: a request whose outcome is unknown is not repeated.

`access_mode` is the mode a Run resolved when it last asked for approval. A Run that never asked reports the mode it started under, from its own override, its Session's mode, the project default (from the project config, which a classic Run loads anyway and an explicit Waggle reads once when it starts; an unreadable one counts as `ask-for-approval`) and the global default, capped by the Session's execution ceiling. Grant and profile ceilings and revocations are consulted only when the Run asks for approval.

## Website

openwaggle.ai reports to the same PostHog project without cookies or local storage: page views, referring domain, channel (search, social, referral, direct), UTM tags, country, and clicks on download and release links. Search terms come from Google Search Console, which reports them in aggregate. To count visitors and link a landing page to a later download click on the same day, the endpoint derives a visitor key from a random salt that rotates every UTC day, the IP address and the browser's User-Agent; it never stores the IP or the salt beyond that day, so keys cannot be linked across days or back to an address. This applies to website visits only, never to app reports. The site's Content Security Policy in `website/public/_headers` allows only the statistics endpoint.

## Never sent

Prompts, model output, code, diffs, file paths, project, repository or branch names, custom provider, model, MCP server, extension or skill names, install, session, thread or turn identifiers, and error text. Error reports go to Sentry separately, scrubbed as described in ADR 0045.

## Provider attribution

When statistics are on, OpenWaggle labels its own OpenRouter requests `HTTP-Referer: https://openwaggle.ai` and `X-OpenRouter-Title: OpenWaggle`, so OpenRouter's public app rankings credit OpenWaggle. OpenWaggle sets these headers on its own requests and never writes its switch into Pi's global `~/.pi/agent/settings.json`. Pi's other product labels, NVIDIA's `X-BILLING-INVOKE-ORIGIN` and the Cloudflare User-Agent, also name OpenWaggle, and `X-OpenRouter-Categories` is removed. When statistics are off, none of Pi's attribution headers are sent. The session headers Pi sends to opencode's provider are functional, not attribution, stay unchanged, and are listed in the privacy notice.

## Deliberately not collected

- How an install heard about OpenWaggle. The app asks no survey questions; self-reported attribution waits for a future account-based service.

## Endpoint events and logs

- The endpoint writes one log line per request with the path (unknown paths as `(unknown)`), outcome (`accepted`, `rejected`, `forward_failed`, `skipped`, `error`), the name of a rejected field, accepted and rejected counts, status code and latency. It never logs the IP address, request headers or rejected values. Requests to `/events` are counted only in the daily buffered totals; other routes send an `endpoint.request` event with the same fields in their own single batch; unknown paths and methods are only logged.
- The endpoint accepts only requests shaped like the app's: one day per request, at most one each of `install.active`, `install.new` and `install.onboarding`, 20 `app.opened`, 5 `update.installed` and 150 `run.*` events. It requires the expected content type, rejects requests whose `Origin` is a web origin outside `/web`, and also `null` on `/events`, `/snapshot` and `/flush`, and forwards only to PostHog's and Sentry's EU hosts.
- A Cloudflare rate-limiting rule on `/api/v1/` processes client IP addresses for abuse protection only; the privacy notice lists it.
- Persistent request logging (Cloudflare Workers Logs or Logpush) stays off for the endpoint, because Cloudflare's automatic request metadata can include the client IP. The endpoint's own structured log lines, visible in Cloudflare's live log stream, never include it.
- Exceptions inside the endpoint go to Sentry.

## Storage

The endpoint never forwards a request as it arrived. It stores each accepted request as one short-lived buffer entry; the daily flush, triggered by the snapshot workflow, aggregates all buffered entries into counts per day, event, field and value (integers become a sum and a count per day, event and field) and forwards only those counts. A day's totals are sent once at least 5 reports of that day can be sent together, and in any case once the day is 7 full UTC days old, so a small install base still gets its numbers within a week. Within a flush, a value, list item or integer sum is published only when at least 5 distinct reports contributed to it. Smaller values are merged into `(other)`, and when `(other)` would stand for fewer than 5 reports, the published values with the fewest reports are folded into it as well; if nothing remains, the breakdown is dropped and only the event total is published. Small integer sums are left out. A short lease makes overlapping flush calls unlikely; the workflow's concurrency group is the guarantee. Reports that lack a value count as their own group for the 5-report rule. Event totals are always published, so a week-old day with fewer than 5 reports publishes only how many times each event happened. Each published row has a UUID derived from the exact set of reports it came from, and the flush records that set before sending, so a retried flush resends identical rows that PostHog deduplicates. A buffer entry holds one install's report for one day until it is flushed, at most 45 days after that day; while it waits it is the only stored record that could single out an install, and the privacy notice says so. Requests to `/events` are counted only inside these buffered totals.

## Retention

- PostHog keeps statistics for the longest period the PostHog plan allows. They identify no one, so no shorter limit is required; the privacy notice states the period in effect.
- Sentry keeps error reports for the period its plan sets, and the privacy notice states it. Error reports can contain personal data that scrubbing missed, so a period longer than debugging needs must be justified in the notice.
