# Compaction Uses One Native Protocol And One Portable Fallback

Status: accepted

OpenWaggle needs one compaction policy across every model without pretending that every provider can preserve Codex-style opaque state. Provider APIs now expose several incompatible forms of context management: the Responses family can return opaque encrypted compaction items, Anthropic can return a readable compaction block, some gateways truncate context, and many transports expose no compaction operation. Treating each provider feature as a separate product behavior would put provider policy in OpenWaggle and make session continuity depend on which model happens to be active.

Pi already owns the agent loop, model transport, session tree, context accounting, and compaction lifecycle. Its append-only session branch retains the entries that precede a compaction boundary. OpenWaggle supplies Pi settings and projects Pi lifecycle events into product state. A Pi extension can replace the text of a compaction summary and persist arbitrary details, but Pi 0.84.4 reconstructs model context from a string summary and its generic message contract cannot replay an opaque compaction item. An extension therefore cannot implement native compaction by itself.

## Decision

OpenWaggle exposes one **Compaction policy**. Pi satisfies it through exactly two **Compaction mechanisms**.

**Native compaction uses only the Responses Compaction protocol.**

- A compatible Responses transport accepts the current canonical context window and returns a canonical replacement window containing an opaque compaction item.
- Pi persists and replays the returned replacement window verbatim. It does not inspect, rewrite, or reduce the opaque content.
- Support is an explicit transport capability. It is not inferred from a provider name, model family, base URL, or generic Responses API support.
- Provider-specific compaction protocols that do not implement this wire contract are outside v1, even if they provide server-side summarization.

**Portable compaction is the only fallback.**

- Every transport without the Responses Compaction protocol uses the same provider-independent fallback.
- The active model produces a **Portable handoff** from Pi's provider-independent session entries using Codex's local handoff content contract: current progress and key decisions; important context, constraints, and user preferences; remaining work and clear next steps; and critical data, examples, or references needed to continue.
- Pi stores the handoff in a versioned provider-independent envelope and retains a **Recent conversation tail** beside it.
- Unlike Codex's local user-message retention, the tail contains the recent full conversation sequence. Tool calls and their results are indivisible retention units, so neither side can survive without the other.
- The tail targets Codex's 20,000 tokens and has no separate post-compaction percentage target. Pi clamps it lower only when required to fit the active model's hard input allowance beside mandatory context and the Portable handoff.
- Pi selects complete chronological units newest-first; messages and tool pairs are never partially retained to fill the remaining budget.
- The handoff preserves stable task state rather than presenting an arbitrary prose transcript summary. Calculating the safe-fit clamp from the active model's hard allowance is an implementation detail, not another user policy.
- The same fallback applies to Claude, Gemini, Mistral, local models, gateways, and any future unsupported transport. There is no provider-specific fallback branch.

**The append-only Pi session branch remains authoritative.**

- A native item or portable handoff is a replaceable **Compaction projection**, not the only durable representation of the session.
- Compaction never deletes the original session entries required to reconstruct a branch.
- An opaque item is replayable only when the active runtime declares the same **Compaction compatibility identity**. Model names, provider names, and generic Responses support do not establish compatibility.
- When the user switches to an incompatible model, Pi performs **Target-model reconstruction** from the authoritative branch. Only the target model may create the replacement projection. The previous model is never called, so switching still works when its credits or credentials are exhausted.
- If the target cannot fit the full reconstruction input, Pi follows Codex's local overflow recovery: remove the oldest complete model-facing units and retry until the request fits or no valid reduction remains. This changes only the attempted projection input; the authoritative branch remains intact.
- The reconstruction input budget reserves the larger of the target model's maximum output or 25 percent of its context window for output, system instructions, tool schemas, and transport framing. Its provider-independent character estimate uses three characters per token. User, custom, bash-execution, branch-summary, and compaction-summary messages begin complete retention units.
- Projection metadata and diagnostics record the source-entry boundary used by a reduced reconstruction, making any omitted model-facing range auditable without changing the composer surfaces.
- Migration failure leaves the durable branch intact and does not silently discard context.

The model-facing implementation belongs in Pi core and its provider transports. OpenWaggle owns configuration, presentation, and lifecycle projection. No OpenWaggle compactor or Pi compaction extension is introduced.

**Automatic compaction uses one configurable percentage threshold.**

- The user-facing setting is a global user preference expressed as a percentage of the active model's advertised context window and defaults to 80 percent.
- Every project and session inherits the current global value. V1 has no project-level or session-level threshold override.
- Pi converts the configured percentage to a token threshold for the active model and may clamp it earlier only when model or transport safety requires more headroom.
- The current Composer context meter continues to show usage and context-window information. The current Compaction status strip continues to show its generic activity state and stop action. Neither surface gains threshold, mechanism, or provider information.
- The versioned Portable compaction envelope layout is an implementation detail governed by these durability and replay rules, not another product policy.

**Automatic compaction follows Codex's turn-boundary scheduling.**

- Before a new turn, Pi evaluates the existing active context before recording that turn's context updates or user message. If the threshold is reached, it compacts inline before the first sampling request.
- After a sampling request and its tools finish, Pi evaluates the updated context. It compacts mid-turn only when model, tool, or queued-input follow-up requires another sampling request.
- If the threshold is crossed by the final sampling request of a completed turn, Pi does not compact while the session is idle. The next turn performs the pre-turn compaction.
- Compaction never interrupts an active model stream. The inline compaction completes at the safe boundary and the pending turn or continuation then resumes.

## Alternatives rejected

**One provider-specific implementation per native API.** Anthropic's readable compaction block and any future vendor protocol could improve a particular provider, but adopting them now would create several runtime semantics and compatibility rules. V1 has one native protocol and one fallback.

**Portable compaction for every model.** This would be uniform, but it would deliberately discard the opaque model state that motivated the work and make Responses-capable models regress to the same lossy summary behavior as Pi today.

**Treat every Responses-compatible endpoint as natively capable.** Supporting `/responses` does not prove that an endpoint supports `/responses/compact`, emits a valid compaction item, or can replay it. Capability must be declared by the transport contract.

**Implement native compaction as a Pi extension.** The extension hook returns a string summary plus arbitrary metadata. Without changes to Pi's context and provider item contracts, the opaque item cannot become model-visible on later turns.

**Use the previous model to bridge an incompatible model switch.** The user may be switching because the previous provider has no remaining credit, expired credentials, or an outage. Model switching must not require another successful request to the model being left.

**Discard the opaque item and keep only recent messages.** This makes switching cheap but silently loses continuity. The durable branch exists specifically so a new projection can be built without destructive loss.

**Compact eagerly after every completed turn that crosses the threshold.** Codex defers this work until another model call is needed. Matching that boundary avoids spending credits to compact a session that may remain idle while still compacting before continued agent work.

**Copy Codex's user-message-only local retention.** Codex retains recent user messages beside its generated local summary. OpenWaggle retains the recent full provider-independent conversation instead because coding continuity also depends on assistant actions, tool calls, and tool results. Tool pairs remain atomic.

**Target a second post-compaction percentage.** Codex uses a fixed 20,000-token local retention target rather than aiming for a percentage after compaction. OpenWaggle follows that behavior and clamps only for the active model's hard fit, avoiding another user-visible or hidden threshold.

**Fall back to Portable compaction after a declared Native compaction request fails.** Codex chooses the mechanism from provider capability before the attempt. Transport retries remain within that mechanism; a failed supported request surfaces as a failed compaction and leaves the current projection intact. Portable compaction is selected when Native compaction is unsupported, not as a silent response to transient native failure.

## Consequences

- Pi needs a transport-level native-compaction capability, a provider-item representation for the canonical replacement window, durable compaction compatibility metadata, and context reconstruction that can install either mechanism.
- Pi's current `summary: string` compaction entry can evolve compatibly into a tagged projection while old JSONL sessions continue to load as Portable compaction.
- OpenWaggle can keep one threshold, manual-compaction command, progress lifecycle, and transcript concept across models. Diagnostics may identify the selected mechanism, but users do not configure provider implementations.
- Automatic compaction can run before a turn or between sampling requests in a continuing turn, but never as idle background work or during an active stream.
- Manual and automatic compaction use the active model's same selected mechanism, replacement pipeline, persistence contract, and failure semantics.
- The fixed reserve-token trigger is no longer the user-facing policy. Existing reserve settings still require a compatibility and migration rule, but project-scoped reserve values do not become threshold overrides.
- A supported Native compaction attempt uses the transport's normal retry policy. Exhausted retries or malformed output leave the previous active projection installed and report failure; they do not silently select Portable compaction.
- Responses-capable transports share one implementation. A provider that adds a different compaction API continues through Portable compaction until it implements the chosen protocol or a later ADR changes this boundary.
- Cross-model migration can cost target-model tokens and lose hidden state that existed only inside a source provider's opaque item. It cannot depend on source-provider availability, and it never destroys the raw branch.
- The Portable compaction schema must be versioned because it becomes durable session data. Its schema and tail-selection rules need regression tests for repeated compaction, exact-budget boundaries, oversized atomic units, tool pairing, resume, branch navigation, and model switching.
- Native integration tests must verify request shape, canonical-window persistence, verbatim replay, repeated compaction, resume after restart, rejection of malformed output, and fallback when the transport does not declare support.

## Implementation

OpenWaggle carries the required Pi 0.84.4 changes as pnpm patches rather than as an extension or a parallel agent loop. `@earendil-works/pi-ai` owns the Responses Compaction transport and the explicit `supportsCompaction`/`compactionBaseUrl` model metadata. `@earendil-works/pi-coding-agent` owns mechanism selection, scheduling, versioned session envelopes, compatible replay, target-only reconstruction, and recent-tail fitting. OpenWaggle injects the global threshold into Pi after project settings are merged and removes that injected value before Pi persists project settings.

The native transport calls the documented `POST /responses/compact` endpoint and persists the canonical `output` array only after verifying that every element is a typed replacement item and that at least one is a valid compaction item. Manual `/compact` instructions are appended to the active system instructions for the same Native request. OpenAI Codex subscription requests reuse the Codex OAuth account contract: the access-token JWT supplies `chatgpt-account-id`, and the request carries `originator: pi` rather than going through API-key-only generic headers. Reported compaction tokens are costed with the active model catalog rates before Pi adds them to session totals. The public API describes the result as an opaque replacement window that should be passed to later Responses requests, so OpenWaggle never parses or summarizes the encrypted content. See the [OpenAI Responses compact reference](https://developers.openai.com/api/reference/resources/responses/methods/compact).

Capability publication is deliberately conservative. The patched built-in catalog marks only model transports for which the public endpoint contract is known: documented OpenAI Responses examples and current OpenAI Codex transports. A model using the Responses API without that explicit metadata remains Portable. Generated provider catalogs are patched at the installed-package boundary, so every Pi upgrade must re-evaluate and regenerate this capability list rather than carrying it forward by model-name inference.

Credential resolution is part of the compatibility identity. If authentication selects a different effective base URL, Pi treats that endpoint as a different target even when provider and model ids are unchanged. Startup and model switching resolve only target credentials, rebuild model-visible history for that effective target, and make no request to the model being left.
