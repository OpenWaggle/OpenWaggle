# Generated Session Titles Follow T3Code, Not Codex

Status: accepted

## Context

A Session title was the first message cut to 60 characters, and a Worker's title was its whole Delegation objective cut to 512. Neither was a label a person could scan to find a Session again. LLM-generated titles existed before the Pi migration and were lost with the old chat adapter, not removed on purpose.

The **Codex parity baseline** says OpenWaggle follows Codex wherever Codex defines session behavior, and Codex does define titling: one background generation from the first message, and a `/rename` that offers an editable suggestion. T3Code goes further, and the maintainer chose T3Code's behavior.

## Decision

A **Session title** is a stable recognition label, not a live topic summary. It is generated in the background, never on the path of a Run or a Spawn, and follows T3Code in these places where it departs from Codex:

- **Title refinement.** When the first generation reports that the request was too vague to name (a bare link, "fix this", an unexplained attachment), the root Session is titled once more after its first completed turn, while it still has one user message. Codex never re-titles automatically.
- **Title regeneration applies directly.** The user's Regenerate action replaces the title from the Session's whole history, prompted with the previous title, and is superseded if the title changes while it runs. Codex only prefills an editable suggestion.
- **A Title model setting.** Automatic by default (the cheapest available model from the Session's own provider), a user-selected model, or Off. Off is an OpenWaggle addition: generation sends the first message or Worker objective in a request the user did not make, so it can be refused.
- **T3Code's prompts and evaluation fixtures**, adapted to say "OpenWaggle session", to write in the user's language, and without linked pull request or issue lookup for now.

Two rules hold everywhere:

- Generation replaces only a **Provisional title** it is responsible for. Explicit titles, user or agent renames, and forks are never overwritten, because a title is also a Worker report reference.
- No title change reorders the sidebar. Recency means recent work, matching T3Code's observable sort.

## Consequences

- Titling is a recorded deviation from the Codex parity baseline; future parity work should not "fix" it back.
- Refinement and regeneration mean a title can change after it is first shown. Both are bounded: refinement fires at most once, early, and only when the first generation could not name the request (flagged as vague, no usable title, a failed request, or an attachment-only first message), and regeneration only on request.
- Title writes must stop driving `updated_at`-based recency, or recency must move to a separate activity timestamp.
