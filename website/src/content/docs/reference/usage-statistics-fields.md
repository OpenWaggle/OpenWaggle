---
title: "Usage statistics fields"
description: "Every event and field in OpenWaggle's anonymous usage statistics and error reports, with the limits the app and the endpoint apply."
section: "Reference"
kind: "reference"
---

Every event, field and value OpenWaggle's anonymous usage statistics and error reports can contain, and the limits on them. The statistics endpoint rejects any event, field or value that is not on this page. [Usage statistics and error reports](/docs/configuration/usage-statistics) explains why OpenWaggle sends them and how to turn them off.

## Fields on every event

| Field | Values |
| --- | --- |
| `version` | App version, such as `1.0.0-beta.4` |
| `build_channel` | Channel of the build you run: `stable`, `beta`, `rc` or `alpha` |
| `update_channel` | Update channel you follow: `stable`, `beta` or `alpha` |
| `os` | `darwin` for macOS, `win32` for Windows, or `linux` |
| `arch` | CPU architecture: `x64` or `arm64` |
| `day` | UTC date, such as `2026-10-02`. Never a time of day |
| `country` | Two-letter country code. The endpoint adds it from the request and then drops your IP address. The app never sends it |

`version` and `previous_version` must be release versions, such as `1.2.3` or `1.2.3-beta.4`, at most 64 characters. The only suffixes are `-alpha.N`, `-beta.N` and `-rc.N`. The endpoint rejects any other shape.

## Install events

| Event | When the app sends it | Fields |
| --- | --- | --- |
| `install.new` | Once, with a new install's first report | None |
| `install.active` | At most once per UTC day, only on a day with at least one run, and never while `CI` is set | See [`install.active` fields](#installactive-fields) |
| `install.onboarding` | Once, after a new install's first day ends | `provider_within_first_day`, `run_within_first_day`, `project_within_first_day` |
| `app.opened` | Each time the app opens | None |
| `update.installed` | The first time a higher version runs | `previous_version` |

The three onboarding fields are `true` or `false`. The app works them out on your machine. Each says whether the install connected a provider, started a run, or opened a project during its first day.

A downgrade, or a channel switch that installs an older build, does not send `update.installed`.

### `install.active` fields

| Field | Values |
| --- | --- |
| `first_this_week` | `true` on the install's first active day of that week |
| `first_this_month` | `true` on the install's first active day of that month |
| `install_age` | `0-7d`, `8-30d`, `31-90d`, `91-365d` or `>365d` |
| `entry_points` | Where that day's runs started: any of `app` (the desktop app), `cli` (terminal commands) and `agent` (runs another agent started) |
| Feature flags | `true` for each [daily feature flag](#daily-feature-flags) the install used that day |
| `mcp_servers` | Catalog MCP servers whose tools the agent called that day, otherwise `custom` |
| `skills` | Built-in skills used that day, otherwise `custom` |
| `extensions_enabled` | Number of enabled extensions as a range: `0`, `1`, `2-5` or `>5`. Never their names |

The app works out `first_this_week` and `first_this_month` on your machine, so the maintainer can count weekly and monthly active installs without an install ID.

The endpoint stores `entry_points` as one combined value, in the order `app`, `cli`, `agent`: for example `app+cli`, `app+agent`, `cli+agent` or `app+cli+agent`. The totals never show how many installs used more than one.

The app sends a feature flag, `mcp_servers` and `skills` only when they are `true` or not empty.

## Run events

The app sends `run.finished` when a run ends.

| Field | Values |
| --- | --- |
| `entry_point` | Where the run started: `app`, `cli` or `agent` |
| `provider` | Provider ID from Pi's built-in catalog, such as `anthropic`, otherwise `custom` |
| `model` | Model ID from that provider's built-in catalog, such as `claude-sonnet-4-5`, otherwise `custom` |
| `thinking_level` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max` |
| `access_mode` | `ask-for-approval` or `yolo` |
| `waggle` | `true` if the run was part of a Waggle conversation |
| `result` | `completed`, `failed` or `interrupted` |
| `duration_s` | Run length in whole seconds, from 0 to 604,800 (one week) |
| `input_tokens` | Input token total for the run |
| `output_tokens` | Output token total for the run |

A provider outside the catalog makes both `provider` and `model` `custom`.

`access_mode` is the mode in force when the run last asked for approval. A run that never asked reports the mode it started under: its own override, its session's mode, the project default, or the global default, limited by the session's ceiling. A project config that cannot be read counts as `ask-for-approval`.

The app sends `run.compacted` when it compacts a conversation's context. Its one field, `mechanism`, is `native` when the model compacts its own context, or `fallback` for the portable summary.

## Daily feature flags

These go with `install.active`. The app sends a flag only when the install used that feature that day.

| Flag | Feature |
| --- | --- |
| `worker_session` | Worker sessions in a Hive |
| `waggle` | Waggle |
| `worktree` | Managed worktrees |
| `terminal` | The built-in terminal |
| `browser_preview` | The browser preview |
| `browser_agent_driven` | An agent driving the browser preview |
| `project_action` | Project actions |
| `inline_visualization` | Inline visualizations |
| `attachment` | Attachments on messages |
| `voice` | Voice input |
| `fork_or_handoff` | Forking a conversation or handing off a session |

## Catalog values

Provider, model, MCP server and skill values outside the public catalogs become `custom`, in the app and again at the endpoint.

| Value | Catalog |
| --- | --- |
| `provider`, `model` | Pi's built-in providers and their models |
| `mcp_servers` | OpenWaggle's curated MCP catalog, by catalog name, such as `playwright` or `chrome-devtools` |
| `skills` | Skills built into OpenWaggle. Today that is only `visualize` |

An MCP server counts as a catalog server only when its name matches a catalog name, with `-` and `_` treated alike, and it runs exactly as the catalog installs it: the same command and arguments, or the same URL. Any other server is `custom`, including a server of your own that only shares a catalog name.

## Limits

| Limit | Value |
| --- | --- |
| `app.opened` events per day | 20 |
| `update.installed` events per day | 5 |
| Run events per day, `run.finished` and `run.compacted` together | 150 |
| `install.active`, `install.new` and `install.onboarding` per day | 1 each |
| Entries in `mcp_servers` or in `skills` | 32 |
| Length of a provider, model, server or skill ID | 128 characters |
| Events in one request | 200 |
| Size of one request | 256 KiB |
| Oldest day the app sends or the endpoint accepts | 35 days |

The app drops events past a daily limit and never sends them later. Each request covers one UTC day.

## Never sent

Usage statistics never contain:

- prompts, model output, code or diffs
- file paths, or project, repository or branch names
- names of custom providers, models, MCP servers, extensions or skills
- install, session, thread or turn identifiers
- error text

The app asks no survey questions either, so OpenWaggle does not know how you heard about it.

## Error reports

An error report covers one of these:

- an error the app reports on purpose
- an error that nothing else handled, which the report tags as `unhandled`
- an Electron helper or renderer process that ended abnormally, reported only by its process type and exit reason

A report keeps only these fields:

| Field | Contents |
| --- | --- |
| Error type | The error's class name. A type defined by code outside the app, such as a Pi extension, becomes `Error` |
| Code | A short code, such as an HTTP status (`http-429`) or a Node.js code (`ECONNRESET`) |
| Stack trace | Scrubbed as described below |
| Time and process | When it happened and which OpenWaggle process reported it |
| App | App version and build channel |
| Method | For an unhandled rejection from one of the app's own API calls, the method's name, such as `getSettings`, taken from OpenWaggle's own bridge |
| System | Operating system name and version, CPU architecture, and the Electron, Chrome and Node.js versions |

The app drops the message text of every report, because a message can quote your files, commands or model output. The one exception is a handled error that the app reports as an application error, which it does only where the message cannot hold your content. No code does that today.

### What the app replaces

Before a report leaves your machine, the app replaces:

| Found in the report | Replaced with |
| --- | --- |
| Your home directory, in each form: `/Users/<name>`, `/home/<name>`, `/var/home/<name>`, `/root`, `/System/Volumes/Data/Users/<name>`, `C:\Users\<name>` (including names with spaces or apostrophes), `\\wsl.localhost\<distro>\home\<name>`, `\\wsl$\<distro>\home\<name>` and `/mnt/<drive>/Users/<name>` | `~` |
| macOS per-user temporary folders under `/var/folders`, and your temporary directory, such as Windows `%TEMP%` | `<tmp>` |
| OpenWaggle scratch folders | `<scratch>` |
| UUIDs, such as session and run IDs | `<id>` |
| Other hexadecimal runs of 16 or more characters | `<hex>` |
| Stack frames from code outside the app, such as a Pi extension, a worktree or any other folder | `<external>` |

An external frame keeps its file name only when the file is named `index`, as in `<external>/index.js`. Its function and module names are dropped, and debug information for that code is reduced the same way. Shared folders such as `/Users/Shared` and `C:\Users\Public` stay as they are.

The app also removes user details, request data, the server name, breadcrumbs, the list of loaded modules, local variables and source lines. The locale, time zone, memory figures, boot and start times, and device name never leave. The app sends no screenshots or session replays, and native crash dumps stay on your machine.

Sentry's session tracking is off, and only error events leave the app. Before Sentry receives a report, the endpoint removes your IP address and applies the same scrubbing again. It forwards only error events, so session data, attachments, crash dumps and replays never reach Sentry. It drops any report it cannot scrub.

## Provider request headers

Pi labels requests to a few model providers with extra headers. The labels go to that provider with your request, never to OpenWaggle. The statistics switch decides them.

| Provider | Statistics on | Statistics off |
| --- | --- | --- |
| OpenRouter | `HTTP-Referer: https://openwaggle.ai` and `X-OpenRouter-Title: OpenWaggle` | None |
| NVIDIA NIM | `X-BILLING-INVOKE-ORIGIN: OpenWaggle` | None |
| opencode | `x-opencode-client: OpenWaggle` | None |

The OpenRouter labels let OpenRouter's public app rankings credit OpenWaggle. OpenWaggle removes the `X-OpenRouter-Categories` header that Pi would otherwise add. It leaves headers you configured yourself alone, and it never writes its switch into Pi's `~/.pi/agent/settings.json`. Setting `PI_TELEMETRY` to anything other than `1`, `true` or `yes` turns statistics off, and Pi then adds none of these labels.

Session titles, MCP sampling requests made for an MCP server, native compaction requests, and model calls from codemode scripts carry no labels. Conversation summaries made for compaction, and branch summaries, carry the same labels as the conversation's own requests.

These headers do not depend on the switch:

| Requests | Header |
| --- | --- |
| Most providers | `User-Agent` naming Pi, with the Pi version, operating system, runtime and processor architecture, such as `pi/1.4.0 (darwin; node/v24.0.0; arm64)` |
| Amazon Bedrock | `pi/1.4.0` added to the AWS SDK's own `User-Agent` |
| GitHub Copilot | Copilot's own `User-Agent` |
| Claude subscription | Anthropic's command-line client `User-Agent`, `claude-cli` |
| ChatGPT subscription | Pi's `User-Agent` and `originator: pi` |
| opencode | `x-opencode-session` with the Pi session ID, which opencode uses to tell sessions apart |

## Endpoint routes

The app sends statistics to `https://openwaggle.ai/api/v1/events` and error reports to `https://openwaggle.ai/api/v1/errors`. The endpoint is a Cloudflare Pages Function, deployed with the website.

The endpoint accepts only requests shaped like the app's own. It requires the expected JSON or Sentry envelope content type, and it forwards only to PostHog's and Sentry's EU hosts.

| Request `Origin` | `/web` | `/errors` | `/events` and the job routes |
| --- | --- | --- | --- |
| None, as the app sends statistics | Accepted | Accepted | Accepted |
| `null` | Accepted | Accepted, because Electron's network layer can send it | Refused |
| An `http` or `https` address | Accepted | Refused | Refused |

Web pages cannot send app requests anyway. The required content type makes the browser ask the endpoint first, in a CORS preflight, and the endpoint refuses it.

## Storage and publishing

The endpoint never forwards a statistics request as it arrived. It stores each accepted request in Cloudflare KV as one entry of counts, under a random key that ties it to no install and no arrival time. An entry holds one install's report for one UTC day. It stays until the daily job publishes it, and at most 45 days after its day ends. The expiry comes from the day, not from when the entry arrived.

Once a day, OpenWaggle's GitHub workflow runs an authenticated job that adds up each day's entries.

| Step | What happens |
| --- | --- |
| Totals | Counts for each event, field and value. A number field such as `duration_s` becomes a sum and a count |
| When a day is sent | Once at least 5 reports of that day can be added up, and in any case once the day is 7 full UTC days old |
| Threshold | A value, list item or number sum appears only when at least 5 distinct reports contributed to it |
| Small values | Merged into `(other)`. If `(other)` would stand for fewer than 5 reports, the next smallest values fold in too. If nothing is left, the breakdown is dropped |
| Missing values | Reports without a value, such as installs that did not use a feature, count as their own group for the threshold |
| Small sums | Left out |
| Event totals | Always published, so a week-old day with fewer than 5 reports publishes only how many times each event happened |

Before it sends a batch, the job records the exact set of entries in a flush manifest. Each published row carries a UUID derived from that set of reports and from what the row counts, so a retried flush resends identical rows and PostHog drops the repeats. Once PostHog accepts the batch, the job deletes the entries. If a delete fails, it writes a small `flushed:` marker for that entry instead, so the entry is never published twice, and it keeps the manifest until every entry is deleted or marked. The markers and the manifest hold no counts and expire with their entries.

Each record in PostHog is a total for one field and value. Every total arrives under one fixed ID that all installs share, filed at noon UTC on its day, with person profiles and PostHog's own location lookup turned off.

## Endpoint logs

The endpoint writes one log line for each request it handles, with only these fields:

| Field | Values |
| --- | --- |
| `path` | The route, or `(unknown)` for a path it does not serve |
| `outcome` | `accepted`, `rejected`, `forward_failed`, `skipped` or `error` |
| `field` | The name of a rejected field |
| `accepted`, `rejected` | How many events it accepted and rejected |
| `status` | The HTTP status code |
| `latency_ms` | How long the request took |

It never logs your IP address, request headers, or the values you sent. Requests to `/events` are counted only inside the daily totals, as `endpoint.requests`. Requests to the other routes also send an `endpoint.request` event with the same fields to PostHog. A request to a path it does not serve is only logged. Cloudflare's stored request logs stay off for the endpoint, because they can include the client IP address. Exceptions inside the endpoint go to Sentry.

## Website statistics

The openwaggle.ai website reports to the same endpoint, at `/api/v1/web`, and to the same PostHog project. For each visit it records:

| Item | Recorded as |
| --- | --- |
| Page views | The path and time, without query strings or fragments |
| Referrer | The referring domain, never the full address |
| Channel | `search`, `social`, `referral` or `direct` |
| Campaign | UTM tags in the link you followed |
| Country | Two-letter country code |
| Download clicks | The kind of link, such as a release download or the install script, never the link itself |

To count visitors, and to connect a landing page with a download click later that day, the endpoint derives a visitor key from your IP address, your browser's User-Agent, and a random salt for the current UTC day. PostHog receives the key, never the address or User-Agent. The salt expires at the next UTC midnight, or up to a minute later when the endpoint creates it in the last minute of a day, because Cloudflare KV keeps a value for at least a minute. The endpoint never uses a salt after its day ends. App reports never use a visitor key.

If Cloudflare KV is unavailable, the endpoint uses a salt kept only in the memory of that server instance for that day, and never writes it anywhere. Visitors served by different instances then get different keys, so the visitor count may run a little high.

The site's Content Security Policy allows only the statistics endpoint. The endpoint drops any beacon that carries `DNT: 1` or `Sec-GPC: 1`.
