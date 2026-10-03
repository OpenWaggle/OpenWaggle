---
status: proposed
---

# Usage statistics carry no persistent identifier

OpenWaggle must comply with the GDPR, and it is a coding agent that people trust with their code. So **Usage statistics** never include a persistent identifier: no install UUID, no hashed machine ID, no salted IP hash, and the receiving service's code stores no IP address; only Cloudflare's rate-limiting rule processes it, for abuse protection. They count **Installs**, never people. Daily, weekly and monthly actives, new installs, retention by install age and step completion come from values the app computes on the machine, such as a first-report-this-week flag or an install-age bucket, and the app sends them with nothing that links one report to another. Stored this way, the data is anonymous and cannot be traced back to anyone.

A future service that needs an account, such as remote use, identifies its user only for that service and keeps its own records. Usage statistics stay anonymous for signed-in users too: OpenWaggle never attaches an account to them and never joins the two.

## Considered options

- A random install ID would allow per-install journeys, exact cohort retention and funnel analysis. It was rejected because it turns every stored record into pseudonymous personal data, with deletion requests, retention duties and breach exposure, and because it breaks the promise that OpenWaggle cannot identify the people who use it.
- Joining signed-in users' statistics to their account would show per-customer behaviour. It was rejected because the promise would weaken to "anonymous unless you sign in", and signing in would quietly change what earlier numbers mean. An account service measures itself from the records it already needs to work.

## Consequences

- A question that needs to follow one install over time is answered by a flag the app computes locally, or not at all.
- Per-turn and per-session events, such as provider, model, reasoning effort, turn result, duration and token totals, carry no install, session, thread or turn identifier, and their timestamps are rounded to the day.
- The receiving service never stores or forwards a report as it arrived. It holds each request briefly in a buffer, and a daily job aggregates every buffered request into per-day counts for each event, field and value, which are the only records the dashboard receives. A value is published only when at least 5 distinct reports contributed to it and at least 5 lacked it or none did; smaller groups fold into `(other)` or the breakdown is dropped. A day is flushed once 5 reports can go together, or once it is 7 days old. Changing either threshold changes this decision. Splitting a report into per-field records at arrival was rejected, because records forwarded together can be regrouped by their ingestion time, and a combination such as Linux on Beta can single out one person.
- Provider, model, MCP server and skill values outside the public catalogs become `custom` in the app, and the receiving service enforces the same catalogs.
- Sending a report still exposes the IP address to the receiving service in transit. That service is a processor under a data processing agreement, discards the address, and the published privacy notice names it.
- Reversing either rule changes a public privacy promise and needs a new ADR.
