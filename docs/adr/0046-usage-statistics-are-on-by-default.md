---
status: proposed
---

# Usage statistics are on by default

Released OpenWaggle builds send **Usage statistics** and error reports by default from the first launch, with no in-app notice. A published privacy notice explains what is sent and how to turn it off, and it is linked from the installation page, the README, the statistics switch in Settings and `openwaggle --help`. A Settings switch, `DO_NOT_TRACK=1` and Pi's `PI_TELEMETRY=0` all turn them off, and Dev builds never send. The same choice controls the provider attribution headers OpenWaggle sends through Pi. OpenWaggle chose this over asking first because complete counts matter for planning v1, comparable tools (T3 Code, Codex and Pi) collect by default, and ADR 0044 keeps every report free of anything that identifies an install or a person.

## Considered options

Asking once, with no answer preselected, is the clearest fit for Article 5(3) of the ePrivacy Directive, which requires consent before an app reads or sends information from a device for purposes that aren't strictly necessary. It was rejected because it would count only the installs that opt in.

A first-launch banner, or a one-line CLI message, shown before anything is sent would make the default easier to defend. It was rejected because T3 Code, Codex and Pi show none and document collection only in their docs and settings, and because a banner interrupts the first launch.

## Consequences

- The legal basis for the IP address that briefly reaches the endpoint is legitimate interest, not consent. A legal review of the privacy notice and of the ePrivacy position for EU users happens before 1.0 Stable.
- The privacy notice and the switch must be easy to find from every place a user installs or configures OpenWaggle, because there is no in-app notice. GDPR Article 13 requires the information to be available when the data is collected.
- Until a company exists, the maintainer is the data controller in person, reachable at `privacy@openwaggle.ai`, and signs the processing agreements with Cloudflare, PostHog and Sentry. The legal review confirms whether Article 27 requires an EU representative.
