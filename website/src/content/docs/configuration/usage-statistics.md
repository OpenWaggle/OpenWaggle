---
title: "Usage statistics and error reports"
description: "What anonymous usage statistics and error reports OpenWaggle sends, why, where they go, and how to turn them off."
order: 3
section: "Help"
kind: "guide"
---

This page covers the anonymous telemetry OpenWaggle sends to its maintainer: usage statistics and error reports. To see what your own model requests cost, use [Usage and cost](/docs/using-openwaggle/usage-and-cost) instead.

Released builds of OpenWaggle send both from the first time you open the app, without asking first. Counting only the installs that opt in would leave the numbers too incomplete to plan with, so OpenWaggle builds the reports to say nothing about who you are. This page is the notice that the switch in Settings and `openwaggle --help` link to. Dev builds, such as one you run from a source checkout, never send anything.

## What OpenWaggle collects and why

The maintainer uses usage statistics to see how many installs are active and which features, providers and models they use. Error reports show what to fix.

Statistics count installs, not people. No report carries an install, person, session, thread or turn identifier, so nothing links one report to another or to you. OpenWaggle's dashboard receives only daily totals.

Usage statistics hold:

- the app version, build and update channel, operating system and CPU architecture, and the UTC date, never a time of day
- your country, which the endpoint adds from the request before it drops your IP address
- when the app opens, when a new install first reports, when a higher version first runs, and whether a new install connected a provider, started a run and opened a project on its first day
- for each run: where it started, the provider and model, the thinking level, the access mode, whether it was part of a Waggle, how it ended, how long it took, and its token totals
- once a day, which features the install used, which catalog MCP servers and built-in skills it used, and how many extensions are enabled

Usage statistics never contain:

- prompts, model output, code or diffs
- file paths, or project, repository or branch names
- names of custom providers, models, MCP servers, extensions or skills
- install, session, thread or turn identifiers
- error text

The app asks no survey questions either, so OpenWaggle does not know how you heard about it.

A provider, model, MCP server or skill that is not in the public catalogs becomes `custom`. [Usage statistics fields](/docs/reference/usage-statistics-fields) lists every event, field and value. The statistics endpoint rejects anything that is not on that page.

## Turn them off

To turn off both usage statistics and error reports, do any one of these:

- Turn off **Share anonymous usage statistics and error reports** in **Settings > General**. It stays off until you turn it back on.
- Set `DO_NOT_TRACK=1`. Any value other than empty, `0`, `false`, `no` or `off` counts.
- Set `PI_TELEMETRY=0`, Pi's own switch. Once `PI_TELEMETRY` is set, only `1`, `true` or `yes`, in upper or lower case, leaves them on. Any other value, even an empty one, turns them off.

OpenWaggle also sends nothing while `CI` is set to any value other than empty, `0`, `false`, `no` or `off`, in upper or lower case, as CI services set it. The same goes for an automated test launch, which `OPENWAGGLE_AUTOMATION=1` marks. There is no command-line switch.

When the build or one of these variables turns statistics off, the Settings switch shows off, cannot be changed, and names the reason. It reads the desktop app's own environment. OpenWaggle keeps your saved choice for when the reason no longer holds.

An environment variable applies only to the processes started with it, including a Session Host that one of those processes starts. A Session Host that is already running, or one the desktop app started, keeps its own environment. An app opened from the Dock, the Start menu or a desktop launcher usually does not see variables from your shell profile. If you are not sure a variable reached every process, use the Settings switch. [Environment variables](/docs/reference/environment-variables#usage-statistics) lists all four.

Turning statistics off deletes the statistics waiting on your machine to be sent. It also removes OpenWaggle's [provider labels](#provider-requests). It does not stop [update checks](#update-checks).

## When statistics are sent

OpenWaggle records statistics on your machine during the day, in the `usage-statistics` folder of its [app data folder](/docs/reference/data-locations#app-data-folder). `app.opened` and, for a new install, `install.new` need no run. The app records the daily `install.active` only on a day with at least one run. It drops anything past the [daily limits](/docs/reference/usage-statistics-fields#limits) and never sends it later.

The Session Host sends each completed UTC day at most once, as one request. It first checks about 5 seconds after it starts, then every hour. So a day's statistics leave your machine only after that day has ended, the next time the Session Host runs.

Before it sends a day, the Session Host marks the day as in flight. If the request times out after the connection opened, the connection resets, or the Session Host stops while sending, it closes the day without sending it again, because the endpoint may already have it. It retries only when the endpoint answers with a server error or `429`, or when the request never left your machine: a failed DNS lookup, a refused or unreachable connection, or a connection attempt that timed out. It drops a day that is more than 35 days old without sending it.

OpenWaggle does not report an install that existed before usage statistics as new. On its first report, the Session Host looks at your oldest session and the date OpenWaggle's database was created. If the earlier of the two comes before the first day of statistics on your machine, it treats `install.new` and `install.onboarding` as already sent and counts `install_age` from that date.

Turning statistics off deletes everything queued and not yet sent. A few install markers stay, such as the first day the install was seen and the last day it reported, so OpenWaggle does not count the install as new if you turn statistics back on.

## Error reports

An error report covers an error the app reports on purpose, an error nothing else handled, or an Electron helper or renderer process that ended abnormally. It keeps the error type, a short code such as `http-429` or `ECONNRESET`, the stack trace, when it happened, which process reported it, the app version and build channel, and the operating system and runtime versions.

The app drops the message text of every report, because a message can quote your files, commands or model output. The one exception is the report of why the app or its Session Host could not start, or why the Session Host stopped on an error, whose message the app builds only from fixed values such as error types and codes. Before a report leaves your machine, the app replaces your home directory with `~`, temporary and scratch folders with placeholders, session and run IDs with `<id>`, and stack frames from code outside the app with `<external>`. [Error reports](/docs/reference/usage-statistics-fields#error-reports) lists every field the app keeps and every replacement it makes. The app sends no screenshots or session replays, and native crash dumps stay on your machine.

Error reports carry no install, person, session, thread or turn identifier. Each report goes out when the error happens, through the same endpoint as statistics. The app never writes reports to disk, and drops a report it cannot send right away.

The error-report library does not load at all in Dev builds, in automated test launches, or when `DO_NOT_TRACK`, `PI_TELEMETRY` or `CI` turns statistics off. It starts only after your settings load, and never in a new process while the Settings switch is off. Your settings come from the Session Host, so if the Session Host does not start, the app cannot load them. To still report why, the Session Host saves the switch's value in `usage-statistics/last-known-setting.json` in the [app data folder](/docs/reference/data-locations#app-data-folder) each time it loads your settings or you change the switch, and the app follows that value. On a new install whose Session Host never created its session database, it follows the default, which is on. With the saved value off, or no saved value once that database exists, it sends nothing. An open window starts its own reporting only once its settings have loaded with statistics on, or later, when you turn them on. If you turn the switch off while the app runs, the app drops every report from then on.

Scrubbing can miss things. A report can still contain personal data, such as a name in a path the rules do not cover. Sentry processes reports under a data processing agreement, and the [retention period](#retention) below applies.

## Where the data goes

1. The app sends statistics to `https://openwaggle.ai/api/v1/events` and error reports to `https://openwaggle.ai/api/v1/errors`. OpenWaggle runs this endpoint on Cloudflare, with its website.
2. The endpoint reads your country from Cloudflare's request data and drops your IP address.
3. It stores each statistics request for a short time, at most 45 days after its day ends, and sends only daily totals to PostHog's EU region in Frankfurt, Germany.
4. It scrubs error reports again and forwards them to Sentry's EU region.

The app never contacts PostHog or Sentry directly and ships no key for either service. The endpoint holds the keys, so OpenWaggle can change the service behind it without an app update, and the rules on this page still apply.

Once a day, a job adds up the stored requests into totals. A value appears in the totals only when at least 5 distinct reports contributed to it, so no one can pick out a single install. While OpenWaggle has few installs, the dashboard mostly shows how many times each event happened. Breakdowns by version, operating system, provider and the other fields appear as more installs report. [Storage and publishing](/docs/reference/usage-statistics-fields#storage-and-publishing) describes the job step by step, and [Endpoint logs](/docs/reference/usage-statistics-fields#endpoint-logs) lists what the endpoint logs about each request. It never logs your IP address.

## Provider requests

Pi, the agent engine OpenWaggle runs on, labels requests to OpenRouter, NVIDIA NIM and opencode with headers that name OpenWaggle. The labels go to that provider with your request, never to OpenWaggle. With statistics on, Pi adds them. With statistics off, it adds none. The OpenRouter labels let OpenRouter's public app rankings credit OpenWaggle.

Whether statistics are on or off, provider requests name Pi in their `User-Agent`, and opencode always receives the Pi session ID, which it uses to tell sessions apart. [Provider request headers](/docs/reference/usage-statistics-fields#provider-request-headers) lists every header for each provider.

## Update checks

Released builds check GitHub for updates a few seconds after launch and every 4 hours after that. Each check asks `api.github.com` for the list of releases and reads the update details from GitHub's release downloads. When a newer release on your channel exists, the app downloads it from there too. `openwaggle update` contacts the same addresses when you run it.

GitHub receives your IP address with these requests, and [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) applies. Update checks are not usage statistics, so the statistics switch does not stop them. Dev builds do not check for updates.

## The openwaggle.ai website

The website reports to the same endpoint and PostHog project as the app. It sets no cookies, uses no local storage, and loads no third-party analytics script. For each visit it records the pages you view, the referring domain, whether you came from search, social, a referral or directly, the UTM tags in the link you followed, your country, and clicks on download and release links. [Website statistics](/docs/reference/usage-statistics-fields#website-statistics) gives the exact form of each.

To count visitors, and to connect a landing page with a download click later that day, the endpoint derives a visitor key from your IP address, your browser's User-Agent, and a random value that changes every UTC day. PostHog receives the key, never the address or User-Agent, with person profiles and location lookup turned off. Because the random value changes every day and the endpoint never stores your IP address, nobody can link a key to another day's keys or trace it back to an address. App reports never use a visitor key.

If your browser sends a Do Not Track or Global Privacy Control signal, the site's script sends nothing, and the endpoint drops any beacon that carries `DNT: 1` or `Sec-GPC: 1`.

Search terms that bring people to the site come from Google Search Console, which reports them only in aggregate. A daily job also reads release download counts and repository traffic from GitHub, and package download counts from npm. These are totals that GitHub and npm publish or show the maintainer, and they describe no individual person.

## GDPR notice

The totals PostHog receives identify no one, so they are not personal data under the GDPR. Five things can be personal data:

- your IP address, while the endpoint handles a request
- your IP address in Cloudflare's rate-limiting rule for `/api/v1/`, which counts requests per address, briefly blocks an address that sends too many, and lists blocked requests in Cloudflare's security events for the maintainer
- a stored statistics entry, which holds one install's report for one UTC day until the daily job publishes it, at most 45 days after that day ends
- a website visitor key, until that day's random value expires
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
| --- | --- | --- |
| Cloudflare | Hosts openwaggle.ai, runs the endpoint, and holds the short-lived statistics entries | Cloudflare's global network, usually the data center nearest you |
| PostHog | Stores and charts the daily statistics totals and website statistics | EU region, Frankfurt, Germany |
| Sentry | Stores error reports | EU region |

When a processor or one of its subprocessors handles data outside the EU, the transfer relies on the processor's data processing agreement and, where the company is certified, on the EU-US Data Privacy Framework.

### Retention

- On your machine, a day of statistics waits at most 35 days to be sent. Turning statistics off deletes it.
- The endpoint never stores your IP address. It holds it only while it handles your request. Cloudflare keeps rate-limit counters only for the counting period, and keeps blocked-request events for the retention its plan sets, currently 31 days.
- Cloudflare KV keeps each stored statistics entry until the daily job publishes it, and at most 45 days after its day ends. Its `flushed:` marker and the flush manifest expire at the same time.
- Nobody can recompute a website visitor key after its day. The endpoint never uses a day's random value after that day ends, and Cloudflare deletes it at the next UTC midnight, or at most a minute later.
- PostHog keeps the statistics totals for the longest period the PostHog plan allows, currently 1 year. They identify no one, so OpenWaggle sets no shorter limit.
- Sentry keeps error reports for the period its plan sets, currently 30 days.

### Your rights

Under the GDPR you can ask for access to personal data about you, its correction or erasure, and restriction of its processing. You can object to the processing at any time, and you can complain to a data protection supervisory authority, for example in the EU country where you live or work.

Neither a stored entry nor a published total carries an identifier, so OpenWaggle cannot tell which ones came from your install. It cannot show them to you or delete them. Article 11 GDPR does not require it to collect extra data just to make that possible, and it does not. If you think an error report contains personal data about you, write to privacy@openwaggle.ai with roughly when the error happened and what it said. That can be enough to find the report and delete it.

## Changes to this page

This page and [Usage statistics fields](/docs/reference/usage-statistics-fields) describe everything the endpoint accepts. When that changes, they change with it.

Last updated on 3 October 2026.
