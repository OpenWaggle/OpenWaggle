---
title: "Usage statistics and error reports"
description: "Every field in OpenWaggle's anonymous usage statistics and error reports, where they go, and how to turn them off."
order: 3
section: "Help"
---

Released builds of OpenWaggle send anonymous usage statistics and error reports. Both are on from the first time you open the app, and OpenWaggle does not ask first. Counting only the installs that opt in would leave the numbers too incomplete to plan with, so OpenWaggle builds the reports to say nothing about who you are. This page is the notice, and the switch in Settings and `openwaggle --help` both link here.

Statistics count installs, not people. No report carries an install, person, session, thread, or turn identifier, so nothing links one report to another or to you. Statistics never contain your prompts, model output, code, file paths, or project, repository, or branch names, and OpenWaggle's dashboard receives only daily totals. Dev builds, such as one you run from a source checkout, never send anything.

The maintainer uses statistics to see how many installs are active and which features, providers, and models they use. Error reports show what to fix.

## Turn them off

To turn off both usage statistics and error reports, do any one of these:

- Turn off **Share anonymous usage statistics and error reports** in **Settings > General**. It stays off until you turn it back on.
- Set `DO_NOT_TRACK=1`. Any value other than empty, `0`, `false`, `no`, or `off` counts.
- Set `PI_TELEMETRY=0`, Pi's own switch. Once `PI_TELEMETRY` is set, only `1`, `true`, or `yes`, in upper or lower case, leaves them on. Any other value, even an empty one, turns them off.

OpenWaggle also sends nothing while the `CI` variable is set, which CI services do, or when `OPENWAGGLE_AUTOMATION=1` marks an automated test launch. There is no command-line switch.

An environment variable applies only to the processes started with it, including a Session Host that one of those processes starts. A Session Host that is already running, or one the desktop app started, keeps its own environment. An app opened from the Dock, the Start menu, or a desktop launcher usually does not see variables from your shell profile. If you are not sure a variable reached every process, use the Settings switch.

Turning statistics off also deletes the statistics waiting on your machine to be sent, as described in [When statistics are sent](#when-statistics-are-sent). It removes OpenWaggle's [provider labels](#provider-requests), but it does not stop [update checks](#update-checks).

## What usage statistics contain

This is the complete list. The statistics endpoint rejects any event, field, or value that is not on it.

Provider, model, MCP server, and skill values outside the public catalogs become `custom`, in the app and again at the endpoint. The catalogs come from Pi's built-in providers and models, OpenWaggle's curated MCP catalog, and OpenWaggle's built-in skills.

### Sent with every event

| Field | What it holds |
|-------|---------------|
| `version` | App version, such as `1.0.0-beta.4` |
| `build_channel` | Channel of the build you run: `stable`, `beta`, `rc`, or `alpha` |
| `update_channel` | Update channel you follow: `stable`, `beta`, or `alpha` |
| `os` | `darwin` for macOS, `win32` for Windows, or `linux` |
| `arch` | CPU architecture, `x64` or `arm64` |
| `day` | UTC date, such as `2026-10-02`, never a time of day |
| `country` | Two-letter country code. The endpoint adds it from the request and then drops your IP address. The app never sends it |

`version` and `previous_version` must be release versions, such as `1.2.3` or `1.2.3-beta.4`. The only suffixes are `-alpha.N`, `-beta.N`, and `-rc.N`, and the endpoint rejects any other shape.

### Install events

| Event | When | Fields |
|-------|------|--------|
| `install.new` | Once, with a new install's first report | None |
| `install.active` | At most once per UTC day, only on a day with at least one Run, and never while `CI` is set | Listed below |
| `install.onboarding` | Once, after a new install's first day ends | `provider_within_first_day`, `run_within_first_day`, and `project_within_first_day` |
| `app.opened` | Each time the app opens | None |
| `update.installed` | The first time a higher version runs | `previous_version` |

The onboarding fields are `true` or `false`, and the app works them out on your machine. Each says whether the install connected a provider, started a Run, or opened a project during its first day.

`install.active` carries:

- `first_this_week` and `first_this_month`, which are `true` on the install's first active day of that week or month. The app works these out on your machine, so the maintainer can count weekly and monthly active installs without an install ID.
- `install_age`, one of `0-7d`, `8-30d`, `31-90d`, `91-365d`, or `>365d`.
- `entry_points`, where that day's Runs started. It can include `app` for the desktop app, `cli` for terminal commands, and `agent` for Runs that another agent started. The dashboard counts the combination as one value, such as `app+cli`, so the totals never show how many installs used more than one.
- The [daily feature flags](#daily-feature-flags).

### Run events

The app sends `run.finished` when a Run ends.

| Field | What it holds |
|-------|---------------|
| `entry_point` | Where the Run started: `app`, `cli`, or `agent` |
| `provider`, `model` | IDs from Pi's built-in catalog, such as `anthropic` and `claude-sonnet-4-5`. A provider outside the catalog makes both `custom`, and a model outside its provider's catalog becomes `custom` |
| `thinking_level` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `access_mode` | `ask-for-approval` or `yolo`, the mode in force when the Run last asked for approval, or the mode it started under if it never asked |
| `waggle` | `true` if the Run was part of a Waggle conversation |
| `result` | `completed`, `failed`, or `interrupted` |
| `duration_s` | Run length in whole seconds |
| `input_tokens`, `output_tokens` | Token totals for the Run |

The app sends `run.compacted` when it compacts a conversation's context. Its one field, `mechanism`, is `native` when the model compacts its own context, or `fallback` for the portable summary.

### Daily feature flags

These go with `install.active`. The app sends a flag only when the install used that feature that day.

| Flag | Feature |
|------|---------|
| `worker_session` | Worker Sessions in a Hive |
| `waggle` | Waggle |
| `worktree` | Managed worktrees |
| `terminal` | The built-in terminal |
| `browser_preview` | The browser preview |
| `browser_agent_driven` | An agent driving the browser preview |
| `project_action` | Project Actions |
| `inline_visualization` | Inline visualizations |
| `attachment` | Attachments on messages |
| `voice` | Voice input |
| `fork_or_handoff` | Forking a conversation or handing off a Session |

Three more fields go with them:

- `mcp_servers` lists the MCP servers connected that day that come from OpenWaggle's curated MCP catalog, by catalog name, such as `playwright` or `chrome-devtools`. Any other server appears as `custom`, including a server of your own that only shares a catalog name.
- `skills` lists the skills used that day that are built into OpenWaggle, currently only `visualize`. Any other skill appears as `custom`.
- `extensions_enabled` gives the number of enabled extensions as a range, `0`, `1`, `2-5`, or `>5`, without names.

### Never sent

Usage statistics never contain:

- prompts, model output, code, or diffs
- file paths, or project, repository, or branch names
- names of custom providers, models, MCP servers, extensions, or skills
- install, session, thread, or turn identifiers
- error text

The app asks no survey questions either, so OpenWaggle does not know how you heard about it.

## When statistics are sent

Collection starts the first time you open the app. `app.opened` and, for a new install, `install.new` need no Run, while the app records `install.active` only on a day with at least one Run.

OpenWaggle records statistics on your machine during the day, in the `usage-statistics` folder of its application-data directory. A day holds at most 20 `app.opened`, 5 `update.installed`, and 150 Run events, and 32 entries in each list. The app drops anything past those limits and never sends it later.

The Session Host sends each completed UTC day at most once, as one request. It first checks about 5 seconds after it starts, then every hour. A day's statistics therefore leave your machine only after that day has ended, the next time the Session Host runs.

Before it sends a day, the Session Host marks that day as in flight. If the request times out after the connection opened, the connection resets, or the Session Host stops while sending, it closes the day without sending it again, because the endpoint may already have it. It retries only when the endpoint answers with a server error or `429`, or when the request never left your machine: a failed DNS lookup, a refused or unreachable connection, or a connection attempt that timed out. It drops a day that is more than 35 days old without sending it.

OpenWaggle does not report an install that existed before usage statistics as new. On its first report, the Session Host looks at your oldest Session and the date OpenWaggle's database was created. If the earlier of the two comes before the first day of statistics on your machine, it treats `install.new` and `install.onboarding` as already sent and counts `install_age` from that date. Only a higher version counts as `update.installed`. A downgrade, or a channel switch that installs an older build, does not.

Turning statistics off deletes everything queued and not yet sent. A few install markers stay, such as the first day the install was seen and the last day it reported, so OpenWaggle does not count the install as new if you turn statistics back on.

## Error reports

An error report covers one of these:

- an error the app reports on purpose
- an error that nothing else handled, which the report tags as `unhandled`
- an Electron helper or renderer process that ended abnormally, reported only by its process type and exit reason

A report keeps only:

- the error type, a short code, and the stack trace. An error type defined by code outside the app, such as a Pi extension, is reported as `Error`
- when it happened, which OpenWaggle process reported it, and the app version and build channel
- the operating system name and version, the CPU architecture, and the Electron, Chrome, and Node.js versions

The short code is something like an HTTP status, `http-429`, or a Node.js code, `ECONNRESET`. The app drops the message text of every report, because a message can quote your files, commands, or model output. The one exception is a handled error that the app explicitly reports as an application error, which it does only where the message cannot hold your content. No code does that today.

Before a report leaves your machine, the app replaces:

- your home directory with `~`, in each form it takes: `/Users/<name>`, `/home/<name>`, `/var/home/<name>`, `/root`, `/System/Volumes/Data/Users/<name>`, `C:\Users\<name>` even when the name has spaces or apostrophes, and the WSL paths `\\wsl.localhost\<distro>\home\<name>`, `\\wsl$\<distro>\home\<name>`, and `/mnt/<drive>/Users/<name>`
- macOS per-user temporary folders under `/var/folders`, and your temporary directory, such as Windows `%TEMP%`, with `<tmp>`
- OpenWaggle scratch folders with `<scratch>`
- UUIDs, such as Session and Run IDs, with `<id>`, and other hexadecimal runs of 16 or more characters with `<hex>`
- stack frames from code outside the app, such as a Pi extension, a worktree, or any other folder, with `<external>`. Only a file named `index` keeps its name, as `<external>/index.js` for example. Their function names and module names are dropped, and debug information for that code is reduced the same way.

Shared folders such as `/Users/Shared` and `C:\Users\Public` stay as they are. The app also removes user details, request data, the server name, breadcrumbs, the list of loaded modules, local variables, and source lines. It keeps no context beyond the list above, so the locale, time zone, memory figures, boot and start times, and device name never leave. It sends no screenshots or session replays, and native crash dumps stay on your machine.

Error reports carry no install, person, session, thread, or turn identifier. Sentry's session tracking is off, and only error events leave the app. Each report goes out when the error happens, through the same endpoint as statistics. The app never writes reports to disk, and drops a report it cannot send right away.

The error-report library does not load at all in Dev builds, in automated test launches, or when `DO_NOT_TRACK`, `PI_TELEMETRY`, or `CI` turns statistics off. It starts only after your settings load, and never in a new process while the Settings switch is off. An open window starts its own reporting only once its settings have loaded with statistics on, or later, when you turn them on. If you turn the switch off while the app runs, the app drops every report from then on.

Before Sentry receives a report, the endpoint removes your IP address and applies the same scrubbing again. It forwards only error events, so session data, attachments, crash dumps, and replays never reach Sentry, and it drops any report it cannot scrub.

Scrubbing can miss things. A report can still contain personal data, such as a name in a path the rules above do not cover. Sentry processes reports under a data processing agreement, and the [retention period](#retention) below applies.

## Where the data goes

1. The app sends statistics to `https://openwaggle.ai/api/v1/events` and error reports to `https://openwaggle.ai/api/v1/errors`. OpenWaggle runs this endpoint as a Cloudflare Pages Function, deployed with its website.
2. The endpoint reads your country from Cloudflare's request data and drops your IP address.
3. It stores each statistics request for a short time and sends only daily totals to PostHog's EU region in Frankfurt, Germany, as described below.
4. It forwards error reports to Sentry's EU region.

The app never contacts PostHog or Sentry directly and ships no key for either service. The endpoint holds the keys, so OpenWaggle can change the service behind it without an app update, and the rules on this page still apply.

The endpoint accepts only requests shaped like the app's own. A statistics request covers one UTC day, with at most one each of `install.active`, `install.new`, and `install.onboarding`, 20 `app.opened`, 5 `update.installed`, and 150 Run events. The endpoint requires the expected content type, rejects any event, field, or value that is not on this page, and replaces identifiers outside the public catalogs with `custom`. It forwards only to PostHog's and Sentry's EU hosts.

Every route except the website's `/web` refuses a request whose `Origin` is an `http` or `https` address. The statistics and job routes also refuse `Origin: null`; the error route accepts it, because Electron's network layer can send it. A request with no `Origin`, which is how the app sends statistics, is accepted. Web pages cannot send these requests anyway. The required JSON or Sentry envelope content type makes the browser ask the endpoint first, in a CORS preflight, and the endpoint refuses it.

### How statistics are stored

The endpoint never forwards a statistics request as it arrived. It stores each accepted request in Cloudflare KV as one entry of counts, under a random key that ties it to no install and no arrival time. An entry holds one install's report for one UTC day. It stays until the daily job publishes it, and at most 45 days after its day ends, an expiry set from the day rather than from when the entry arrived. While it waits, it is the one place where OpenWaggle stores a whole install-day as a combination, which is why the [GDPR notice](#gdpr-notice) lists it.

Once a day, OpenWaggle's GitHub workflow runs an authenticated job that adds up each day's entries into totals: counts for each event, field, and value, and for number fields such as `duration_s`, a sum and a count. The job sends a day's totals once it can add up at least 5 reports of that day, and in any case once the day is 7 full UTC days old.

Before it publishes anything, the job applies a threshold. A value, a list item, or a number sum appears only when at least 5 distinct reports contributed to it. The job merges smaller values into the value `(other)`. If `(other)` would then stand for fewer than 5 reports, it folds in the next smallest values too, and if nothing is left it drops that breakdown entirely, so no one can work out a small value by subtracting the others from the total. Reports that lack a value, such as installs that did not use a feature that day, count as their own group for this rule. It leaves small sums out. It always publishes event totals, how many times each event happened, so a week-old day with fewer than 5 reports publishes only its event totals.

While OpenWaggle has few installs, the dashboard will mostly show totals. Breakdowns by version, operating system, provider, and the other fields appear as more installs report.

Before it sends a batch, the job records the exact set of entries in a flush manifest. Each published row carries a UUID derived from the exact set of reports in the batch and from what the row counts, so a retried flush resends identical rows and PostHog drops the repeats. Once PostHog accepts the batch, the job deletes the entries. If a delete fails, it writes a small `flushed:` marker for that entry instead, so the entry is never published twice, and it keeps the manifest until every entry is deleted or marked. The markers and the manifest hold no counts and expire with their entries.

Each record in PostHog is a total for one field and value, and none carries anything that points to an install. Every total arrives under one fixed ID that all installs share, filed at noon UTC on its day, with person profiles and PostHog's own location lookup turned off.

### Endpoint logs

The endpoint writes one log line for each request it handles, with only:

- `path`, or `(unknown)` for a path it does not serve
- `outcome`, one of `accepted`, `rejected`, `forward_failed`, `skipped`, or `error`
- `field`, the name of a rejected field
- `accepted` and `rejected`, how many events it accepted and rejected
- `status`, the HTTP status code
- `latency_ms`, how long the request took

It never logs your IP address, request headers, or the values you sent. The endpoint counts requests to `/events` only inside the daily totals, as `endpoint.requests`. Requests to its other routes also send an `endpoint.request` event with the same fields to PostHog, and a request to a path it does not serve is only logged. Cloudflare's stored request logs stay off for the endpoint, because they can include the client IP address.

## Provider requests

Pi, the agent engine OpenWaggle runs on, labels requests to a few model providers with extra headers. The labels go to that provider with your request, never to OpenWaggle, and the statistics switch decides them:

| Provider | Statistics on | Statistics off |
|----------|---------------|----------------|
| OpenRouter | `HTTP-Referer: https://openwaggle.ai` and `X-OpenRouter-Title: OpenWaggle` | None |
| NVIDIA NIM | `X-BILLING-INVOKE-ORIGIN: OpenWaggle` | None |
| Cloudflare Workers AI and AI Gateway | `User-Agent: OpenWaggle` | The provider SDK's own `User-Agent` |

The OpenRouter labels let OpenRouter's public app rankings credit OpenWaggle. OpenWaggle removes the `X-OpenRouter-Categories` header that Pi would otherwise add, and leaves headers you configured yourself alone. Setting `PI_TELEMETRY` to anything other than `1`, `true`, or `yes` turns statistics off, and Pi then adds none of these labels. MCP sampling requests that OpenWaggle sends to OpenRouter on behalf of an MCP server carry no attribution labels.

The opencode providers always receive the Pi session ID in `x-opencode-session`, plus `x-opencode-client: pi`. opencode uses them to tell sessions apart. The statistics switch does not change them.

## Update checks

Released builds check GitHub for updates a few seconds after launch and every 4 hours after that. Each check asks `api.github.com` for the list of releases and reads the update details from GitHub's release downloads. When a newer release on your channel exists, the app downloads it from there too. `openwaggle update` contacts the same addresses when you run it.

GitHub receives your IP address with these requests, and [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) applies. Update checks are not usage statistics, so the statistics switch does not stop them. Dev builds do not check for updates.

## The openwaggle.ai website

The website reports to the same endpoint and PostHog project as the app. It sets no cookies, uses no local storage, and loads no third-party analytics script. For each visit it records:

- the pages you view and when, by path, without query strings or fragments
- the referring domain, never the full address of the page that linked to the site
- the channel, one of search, social, referral, or direct
- UTM tags in the link you followed
- your country
- clicks on download and release links, recorded as the kind of link, such as a release download or the install script, never the link itself

To count visitors, and to connect a landing page with a download click later that day, the endpoint derives a visitor key from your IP address, your browser's User-Agent, and a random salt for the current UTC day. PostHog receives the key, never the address or User-Agent, with person profiles and location lookup turned off.

The salt expires at the next UTC midnight, or up to a minute later when the endpoint creates it in the last minute of a day, because Cloudflare KV keeps a value for at least a minute. The endpoint never uses a salt after its day ends and never stores your IP address, so nobody can link a key to another day's keys or trace it back to an address. App reports never use a visitor key.

If Cloudflare KV is unavailable, the endpoint uses a salt kept only in the memory of that server instance for that day. It never uses that salt after its UTC day and never writes it anywhere. Visitors served by different instances then get different keys, so the visitor count may run a little high.

If your browser sends a Do Not Track or Global Privacy Control signal, the site's script sends nothing. The endpoint also drops any beacon that carries `DNT: 1` or `Sec-GPC: 1`.

Search terms that bring people to the site come from Google Search Console, which reports them only in aggregate. A daily job also reads release download counts and repository traffic from GitHub, and package download counts from npm. These are totals that GitHub and npm publish or show the maintainer, and they describe no individual person.

## GDPR notice

The totals PostHog receives identify no one, so they are not personal data under the GDPR. Five things can be personal data:

- your IP address, while the endpoint handles a request
- your IP address in Cloudflare's rate-limiting rule for `/api/v1/`, which counts requests per address, briefly blocks an address that sends too many, and lists blocked requests in Cloudflare's security events for the maintainer
- a buffered statistics entry, which holds one install's report for one UTC day until the daily job publishes it, at most 45 days after that day ends
- a website visitor key, until that day's salt expires
- personal data that scrubbing missed in an error report

The rest of this section covers them.

### Controller

The controller is the OpenWaggle maintainer, Diego Garcia Brisa, acting in person until a company exists. Write to [privacy@openwaggle.ai](mailto:privacy@openwaggle.ai) about anything on this page.

### Purposes and legal basis

Usage statistics show the maintainer what to build next, and error reports show what to fix. Website statistics show how people find OpenWaggle and whether they download it. The endpoint uses your IP address only to handle the request, look up your country, and, on the website, compute that day's visitor key. Cloudflare's rate-limiting rule also uses it to protect the endpoint from abuse.

The legal basis is legitimate interest, under Article 6(1)(f) GDPR. The interests are building and fixing OpenWaggle based on how people use it, and protecting the endpoint from abuse. The design keeps the effect on you small. Reports carry no identifier, the endpoint drops your IP address, statistics contain nothing about your work, and the dashboard receives only daily totals.

You can object at any time. In the app, turn statistics off as described in [Turn them off](#turn-them-off). On the website, send a Do Not Track or Global Privacy Control signal. You do not have to provide this data, and OpenWaggle works the same without it. OpenWaggle makes no automated decisions about anyone from it.

### Recipients

The data goes only to these processors, each under a data processing agreement with the controller:

| Processor | Role | Location |
|-----------|------|----------|
| Cloudflare | Hosts openwaggle.ai, runs the endpoint, and holds the short-lived statistics entries | Cloudflare's global network, usually the data center nearest you |
| PostHog | Stores and charts the daily statistics totals and website statistics | EU region, Frankfurt, Germany |
| Sentry | Stores error reports | EU region |

When a processor or one of its subprocessors handles data outside the EU, the transfer relies on the processor's data processing agreement and, where the company is certified, on the EU-US Data Privacy Framework.

### Retention

- On your machine, a day of statistics waits at most 35 days to be sent. Turning statistics off deletes it.
- The endpoint never stores your IP address. It holds it only while it handles your request. Cloudflare keeps rate-limit counters only for the counting period, and keeps blocked-request events for the retention its plan sets, currently 31 days.
- Cloudflare KV keeps each buffered statistics entry until the daily job publishes it, and at most 45 days after its day ends. Its `flushed:` marker and the flush manifest expire at the same time.
- Nobody can recompute a website visitor key after its day. The endpoint never uses a salt after its day ends, and Cloudflare deletes it at the next UTC midnight, or at most a minute later.
- PostHog keeps the statistics totals for the longest period the PostHog plan allows, currently 1 year. They identify no one, so OpenWaggle sets no shorter limit.
- Sentry keeps error reports for the period its plan sets, currently 30 days.

### Your rights

Under the GDPR you can ask for access to personal data about you, its correction or erasure, and restriction of its processing. You can object to the processing at any time, and you can complain to a data protection supervisory authority, for example in the EU country where you live or work.

Neither a buffered entry nor a published total carries an identifier, so OpenWaggle cannot tell which ones came from your install. It cannot show them to you or delete them. Article 11 GDPR does not require it to collect extra data just to make that possible, and it does not. If you think an error report contains personal data about you, write to privacy@openwaggle.ai with roughly when the error happened and what it said. That can be enough to find the report and delete it.

## Changes to this page

This page describes everything the endpoint accepts. When that changes, this page changes with it.

Last updated on 3 October 2026.
