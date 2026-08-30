# OpenWaggle Context

OpenWaggle is an Electron desktop coding-agent workspace built on Pi. This glossary captures product-domain language that should stay stable across planning, issues, docs, and implementation.

Unless a statement is explicitly labelled as current implementation, this glossary describes the agreed product model. The Session Host cutover implements the Session Control, Hive, and native Sessions-tool model below; older entries that describe the pre-cutover runtime are historical context.

## Language

**Codex parity baseline**:
The normative observable behavior OpenWaggle follows for sessions, subagents, workspace placement, lifecycle, steering, queues, CLI coordination, and user-visible activity whenever Codex defines that behavior.
_Avoid_: Codex-inspired, approximate parity, similar UX

**Codex protocol adapter**:
An optional boundary adapter that translates a negotiated supported subset of Codex App Server JSON-RPC thread and turn operations into Session Control without making Codex wire types part of OpenWaggle's domain or persistence model.
_Avoid_: Session Control protocol, direct Codex storage, parity requirement

**OpenWaggle MCP integration**:
The complete first-party product capability through which OpenWaggle consumes and optionally serves the Model Context Protocol.
_Avoid_: Pi MCP extension, MCP plugin

**MCP runtime**:
The OpenWaggle-owned per-session subsystem that resolves MCP state, negotiates protocol capabilities, manages connections and tasks, and projects authorized tools into Pi.
_Avoid_: MCP agent loop, Pi adapter extension

**MCP desired state**:
The user's global, project, or session request for MCP to be on, off, or inherited, independent from the currently applied runtime state.
_Avoid_: extension enabled flag

**MCP effective configuration**:
The fully resolved server, scope, policy, trust, authentication, sandbox, and capability configuration with provenance for every contributing source.
_Avoid_: merged mcp.json, Pi settings

**MCP turn snapshot**:
The immutable MCP effective configuration, catalog revision, handles, credentials, grants, and capability negotiation used by one agent turn.
_Avoid_: live mutable MCP config

**MCP gateway**:
The stable, catalog-free `mcp` model tool that provides deferred list, search, describe, and single-call access through opaque handles.
_Avoid_: injected MCP tool registry

**MCP orchestration**:
Confined multi-call composition through `mcp_run`, where intermediate results remain outside model context and every child call keeps its own policy and audit lifecycle.
_Avoid_: arbitrary code execution, OpenCode Code Mode as the product name

**MCP direct exposure**:
An explicit opt-in that places selected individual MCP tool definitions on the model's native tool list.
_Avoid_: default MCP mode, compatibility fallback

**MCP capability handle**:
An opaque session-, revision-, schema-, and identity-bound reference returned by deferred discovery and required for dispatch.
_Avoid_: tool name as authority

**MCP compatibility module**:
An isolated implementation of deprecated or vendor-specific protocol behavior that cannot weaken modern MCP defaults.
_Avoid_: silent legacy fallback

**MCP trust record**:
A fail-closed approval bound to server identity, effective configuration hash, package or endpoint identity, requested capabilities, and security profile.
_Avoid_: trusted server name

**MCP capability grant**:
A scoped authorization for one server capability, data class, destination, project/session, and schema/config revision.
_Avoid_: blanket server approval

**MCP Task**:
A durable OpenWaggle record of asynchronous MCP work that can be inspected, resumed, cancelled when supported, or completed without holding an agent turn open.
_Avoid_: long-running tool call

**MCP Event Inbox**:
The opt-in attributed queue for proactive external MCP events, separate from standard state subscriptions and agent context.
_Avoid_: automatic server prompt

**MCP App host**:
The sandboxed OpenWaggle-owned container and JSON-RPC bridge for standard `ui://` MCP Apps.
_Avoid_: extension runtime, trusted webview

**OpenWaggle MCP server profile**:
The authenticated, revocable set of projects, session operations, agent capabilities, rates, and approval delegation exposed by `openwaggle mcp serve` to one caller.
_Avoid_: inherited desktop permissions

**Session Control**:
The first-party OpenWaggle domain service through which authorized agents or adapters list, read, create, fork, steer, wait for, interrupt, hand off, and organize sessions.
_Avoid_: MCP-owned sessions, loopback MCP orchestration

**Session Host**:
The single per-user OpenWaggle process that owns Session Control, live agent runs, durable Follow-up queues, and their ordered live event stream.
_Avoid_: Electron window process, CLI daemon, MCP session server

**Local Session transport**:
The authenticated local full-duplex connection through which out-of-process OpenWaggle clients call and subscribe to the Session Host.
_Avoid_: WebSocket API, database coordination, loopback MCP

**Sessions tool**:
The compact capability-scoped Pi-native surface through which an OpenWaggle-hosted agent invokes Session Control.
_Avoid_: CLI shell command, loopback MCP tool, parallel session runtime

**Session Control contract version**:
The declared schema revision of a Session Control boundary adapter's commands, results, events, and errors, used to reject incompatible mutation semantics rather than reinterpret them silently.
_Avoid_: host protocol revision, database schema version, app version

**Session creation**:
An operation that creates an idle configured session without starting an agent run.
_Avoid_: spawn, run start

**Session launch**:
An atomic operation that creates an independent root Session and starts its initial agent Run from one objective.
_Avoid_: Session spawn, create then start, root spawn

**Session spawn**:
An atomic operation that creates a configured session and starts its initial agent run from one objective.
_Avoid_: create then submit, subagent process

**Spawn lineage**:
The immutable parent-session, parent-run, child-session, depth, and origin relationship created by a Session spawn.
_Avoid_: session folder, caller label

**Hive**:
The user-facing and agent-facing name for the complete family of Sessions connected through Spawn lineage from one root Session.
_Avoid_: process pool, hidden agent group, Workspace

**Queen Session**:
The single root Session of a Hive, named for originating the Hive rather than for commanding its descendants.
_Avoid_: every parent Session, privileged Session, supervisor process

**Worker Session**:
Any non-root Session in a Hive, including one that is itself the parent of further Worker Sessions.
_Avoid_: disposable subagent, child process, leaf Session

**Delegation Contract**:
The durable objective-bearing agreement attached to a Session spawn that progressively records the assigned outcome, scope claims, deliverables, acceptance criteria, dependencies, and completion evidence.
_Avoid_: spawn prompt, child transcript, session status, task label

**Delegation specification**:
An immutable revision of a Delegation Contract's objective, deliverables, acceptance criteria, and dependencies against which one submission may be reviewed.
_Avoid_: mutable prompt, child-authored assignment, current session instructions

**Delegation state**:
The lifecycle classification of an unresolved, reviewable, accepted, or cancelled Delegation Contract independently of its child Session and Run states.
_Avoid_: child status, run phase, Active/Done group

**Delegation submission**:
An immutable revisioned result and evidence set offered by a child or captured by the Session Host for review against one Delegation Contract.
_Avoid_: final message, mutable result, acceptance

**Delegation evidence**:
A provenance-bearing bounded reference supporting a Delegation submission through an observed command, Workspace diff, artifact, source reference, or explicitly asserted note.
_Avoid_: copied log, unlabelled claim, mutable attachment

**Delegation verification**:
An immutable reviewer-authored result against one exact Delegation submission, recording a `passed`, `failed`, or `inconclusive` outcome and bounded verification evidence without accepting the contract implicitly.
_Avoid_: acceptance alias, hidden test rerun, mutable check result, self-verification

**Delegation scope claim**:
A mutable advisory declaration of the Workspace resources a child expects to read or write while fulfilling one Delegation Contract.
_Avoid_: filesystem permission, lock, ownership, sandbox rule

**Delegation claim target**:
The typed Workspace-relative file, Workspace-relative directory tree, or namespaced logical resource named by a Delegation scope claim.
_Avoid_: arbitrary glob, absolute path, unresolved alias

**Delegation conflict**:
The durable advisory evidence that two active write Delegation scope claims intersect in one live Workspace or across related repository Workspaces.
_Avoid_: filesystem lock, merge conflict, permission denial

**Undeclared write observation**:
The durable advisory evidence that a write attributable to one isolated Worker turn changed a Workspace path outside every write claim in that Delegation's latest claim revision.
_Avoid_: permission violation, inferred shared-worktree authorship, blocked write

**Delegation dependency**:
An acyclic relationship requiring another Delegation Contract to reach a declared review condition before the dependent contract may be accepted.
_Avoid_: hidden run queue, session dependency, automatic spawn ordering

**Derived child-management grant**:
The non-escalating capability grant returned to a spawning agent for authorized control of the newly spawned child session.
_Avoid_: inherited target permissions, workspace-wide grant

**Spawn profile inheritance**:
The resolution of a new child session's execution profile from the parent's live profile plus authorized child-specific specialization.
_Avoid_: permission inheritance, caller profile transfer

**Launch profile seeding**:
The resolution of an independent root Session's non-authority execution defaults from its initiating context without creating parent lineage or transferring a management grant.
_Avoid_: Spawn profile inheritance, authorization inheritance, root specialization

**Agent definition**:
An optional user- or project-scoped named specialization selectable for one Session launch or spawn, containing its purpose, Agent instructions, and permitted execution-profile defaults without defining lineage or a multi-agent workflow.
_Avoid_: Worker Session, Queen Session, required agent class, Waggle preset, CLI client profile, session template

**Agent instructions**:
The reusable agent-level instruction layer supplied by an Agent definition's Markdown body, kept separate from the per-invocation Delegation task and mapped by the runtime adapter to the provider's appropriate system or developer instruction mechanism.
_Avoid_: Delegation task, concatenated spawn prompt, permission grant

**Agent definition document**:
The canonical Markdown file whose strictly validated YAML frontmatter configures one Agent definition and whose Markdown body supplies its Agent instructions.
_Avoid_: agent JSON, Codex TOML layer, executable Markdown, prompt template

**Agent definition schema**:
The published versioned JSON Schema and semantic validation contract for OpenWaggle Agent-definition frontmatter and Markdown-body requirements.
_Avoid_: parser implementation, example file, foreign agent schema

**Agent definition import plan**:
The non-mutating conversion result that maps one recognized foreign agent definition into the OpenWaggle schema and reports every mapped, defaulted, dropped, incompatible, and user-choice field before writing.
_Avoid_: file copy, best-effort parse, automatic discovery

**Imported Agent snapshot**:
The canonical OpenWaggle Agent definition created from one foreign definition with source tool, source path, source digest, importer version, and refresh baseline recorded as provenance rather than a live link.
_Avoid_: synchronized agent file, foreign definition proxy, watched import

**Agent role selection**:
The optional choice of an Agent definition for one Session launch or spawn, resolved by stable name before its effective execution profile is produced.
_Avoid_: Waggle invocation, model override, caller identity

**Resolved Agent snapshot**:
The immutable validated Agent-definition content and provenance captured when one Session launch or spawn is accepted, including its stable name, source scope, schema version, source digest, instructions, and effective specialization.
_Avoid_: live Agent definition, Imported Agent snapshot, agent file reference

**Agent definition discovery**:
The bounded on-demand listing or search of authorized Agent-definition names, descriptions, and scopes without injecting every definition into each agent Run.
_Avoid_: automatic prompt injection, eager definition loading, foreign-agent discovery

**Agent definitions settings surface**:
The unified Settings page for listing, validating, creating, editing, duplicating, importing, and deleting project- and user-scoped Agent definition documents while leaving their Markdown files canonical.
_Avoid_: session sidebar section, Agent role picker, proprietary definition database

**Parent concurrency limit**:
The user-configurable maximum number of child sessions that one parent session may have running concurrently.
_Avoid_: hard-coded worker count, host-wide limit, queued spawn count

**Host run ceiling**:
The app-global user-configurable maximum number of active Pi agent runs owned by one Session Host across root and descendant sessions.
_Avoid_: workspace limit, provider rate limit, session count, hidden run queue

**Live orchestration smoke suite**:
The mandatory pre-release QA workflow that uses a real configured model provider to prove multi-session spawning, control, event projection, and completion across the OpenWaggle agent, GUI, CLI, and external MCP boundaries.
_Avoid_: ordinary CI, mocked integration test, manual happy-path note

**Hive activity surface**:
The unified composer-adjacent projection of a Session's immediate parent and direct Workers, with Workers grouped by active, completed, and archived state.
_Avoid_: child activity surface, subagent store, hidden session list, child transcript copy

**Session identity header**:
The persistent top-of-session title and metadata surface that identifies the selected Session's Hive role and optional Resolved Agent snapshot without becoming a navigation or management panel.
_Avoid_: Hive activity surface, Session sidebar row, Agent definitions settings surface

**Agent Session identity context**:
The small host-authored per-Run context that tells an agent its Session identity, Hive role and immediate parent, Resolved Agent snapshot name, current Workspace binding, and effective Session Control operations.
_Avoid_: eager Hive transcript, child-session prompt injection, Agent instructions, user-authored identity claim

**Orchestration update**:
An OpenWaggle-authored model-visible report of child-session progress or completion delivered to its parent workflow.
_Avoid_: user message, steering message, follow-up message

**Cross-session report**:
An explicitly authored durable model-visible context item routed from one Session to authorized lineage targets without starting, steering, interrupting, or reopening a Run or changing a Delegation Contract.
_Avoid_: Message submission, Orchestration update, Delegation submission, broadcast by implication

**Session wait**:
A bounded operation that returns when one target session reaches a requested condition or the wait timeout expires.
_Avoid_: subscription, polling loop, watch

**Session subscription**:
A persistent live event feed from the Session Host for authorized session targets, with only bounded recent-event replay.
_Avoid_: wait, WebSocket, renderer listener

**Session event cursor**:
A host-instance-scoped position in the Session Host's bounded recent-event replay window, used to bridge snapshot-to-subscription and short connection gaps rather than as durable history.
_Avoid_: transcript cursor, permanent replay offset, database log position

**Session resynchronization**:
The recovery path that discards a client's stale projection and rebuilds it from canonical Session state and paginated history after its Session event cursor is unavailable.
_Avoid_: replaying the run, restarting the session, best-effort continuation

**Session watch**:
The CLI presentation of a Session subscription as a continuous human-readable or structured event stream.
_Avoid_: wait, tailing session files

**Session discovery text**:
The compact searchable description of a session formed from its title, initial objective, and current preview.
_Avoid_: transcript, full session content, hydrated session

**Session discovery**:
The read-only operation that finds authorized sessions through hybrid lexical and semantic retrieval over Session discovery text and metadata without loading, resuming, or subscribing to them.
_Avoid_: transcript search, session read, sidebar filter

**Session conversation view**:
The read projection combining a Session tree with its selected active branch, selected node, branch state, and resulting transcript path for navigation and rendering.
_Avoid_: Session workspace, execution workspace, transcript read snapshot

**Session catalog scope**:
The explicit `working-path`, `project`, or `all` boundary applied before authorized session listing or discovery: the caller's resolved current Working path, every Workspace in its repository project, or the complete authorized catalog.
_Avoid_: authorization scope, transcript scope, implicit global search

**Session discovery mode**:
The caller-selected hybrid, lexical, or semantic retrieval policy for one Session discovery query.
_Avoid_: search provider, ranking preset, fuzzy-search flag

**Semantic discovery readiness**:
The reported availability and freshness of the local embedding model and semantic projection used by Session discovery.
_Avoid_: model download spinner, search enabled flag, vector database status

**Semantic discovery preparation**:
The observable background operation that downloads, validates, loads, or rebuilds the resources required for semantic Session discovery.
_Avoid_: search request, implicit retry loop, model installer

**Semantic discovery snapshot**:
The latest published set of session embeddings and model revision available for semantic Session discovery.
_Avoid_: live transcript index, search cache, database snapshot

**Session discovery evidence**:
The bounded authorized explanation of a discovery result's match kind, matched fields, snippet, rank, and semantic freshness.
_Avoid_: raw relevance score, ranking trace, transcript excerpt

**Session discovery window**:
The bounded relevance-ranked set selected from the complete authorized session corpus for one Session discovery query.
_Avoid_: exhaustive session list, search page, vector candidate set

**Session discovery cursor**:
The opaque caller-bound position within one immutable short-lived Session discovery window.
_Avoid_: list offset, reusable page token, database cursor

**Session read**:
The read-only retrieval of one session's metadata, runtime state, queue summary, lineage, semantic status, and optionally a bounded transcript slice.
_Avoid_: session resume, subscription, full-history response

**Transcript read snapshot**:
The stable authorized transcript scope and high-water mark through which every matching turn and item can be traversed with bounded pages.
_Avoid_: transcript window, session export, live subscription

**Transcript turn**:
The durable transcript grouping corresponding to one OpenWaggle run from accepted start through terminal outcome.
_Avoid_: user message, assistant response, Pi entry

**Transcript item**:
One ordered durable message, tool activity, interaction, state change, or outcome belonging to a Transcript turn.
_Avoid_: turn, rendered message bubble, raw stream chunk

**Transcript item view**:
The none, summary, or full content depth requested for Transcript items returned with Transcript turns.
_Avoid_: transcript filter, export format, renderer mode

**Transcript search**:
The explicit read-only operation that searches authorized conversational content beyond Session discovery text.
_Avoid_: default session search, session discovery, session read

**Transcript search scope**:
The caller-selected classes of authorized Transcript item content eligible for one Transcript search.
_Avoid_: branch scope, session capability, item view

**Semantic transcript projection**:
The lazily prepared target-scoped embedding index whose matches reference exact Transcript turn and item ranges.
_Avoid_: global transcript vector store, Session discovery embedding, transcript summary

**Semantic transcript storage policy**:
The durable bounded-cache policy that leases active Semantic transcript projections, expires inactive scopes, evicts them by least-recent access, and reports partial coverage when an admitted scope exceeds its node, vector-byte, queue, or per-Session limits.
_Avoid_: transcript retention policy, semantic completeness guarantee, unbounded vector cache

**Session export**:
The schema-versioned streamed representation of an authorized session read snapshot as canonical JSONL, readable Markdown, or a resource bundle.
_Avoid_: Pi session file, database backup, transcript read

**Session export bundle**:
The portable manifest, canonical JSONL, and explicitly included authorized resources with integrity metadata.
_Avoid_: project archive, worktree export, raw attachments folder

**Export redaction profile**:
The explicit named transformation that removes or replaces selected authorized export content and records every change in the manifest.
_Avoid_: silent secret filtering, read authorization, lossy format

**Session export operation**:
The durable Session Host work record that produces a destination file or bundle independently of the initiating client connection.
_Avoid_: stdout stream, MCP Task, agent run

**Sessions CLI**:
The stable `openwaggle sessions` command family through which people and external agentic tools invoke Session Control.
_Avoid_: session shell, Pi CLI, MCP session client

**Delegations CLI**:
The stable `openwaggle delegations` command family through which people and external agentic tools discover, contribute to, review, and verify Delegation Contracts.
_Avoid_: nested session transcript command, task-file editor, child process controller

**Access CLI**:
The administrative `openwaggle access` command family for user-authorized management of optional local caller identities and credentials outside Session Control.
_Avoid_: sessions access command, authentication daemon, project policy file

**Sessions CLI machine output**:
The schema-versioned JSON or JSONL response contract emitted only when explicitly requested by a Sessions CLI caller.
_Avoid_: TTY detection, parsed human output, mixed progress stream

**Sessions CLI message input**:
The single explicit text, stdin, UTF-8 file, typed request, or attachment-bearing source selected for one messaging command.
_Avoid_: implicit prompt, inferred pipe, shell-history message

**CLI client profile**:
An optional named revocable caller identity, credential, capability grants, and project or session scopes used when a local tool needs less authority or separate attribution than the Local-user identity.
_Avoid_: shell user, model profile, MCP server profile

**Local-user identity**:
The zero-setup Session Host caller identity assigned to a CLI connection whose OS peer credentials match the signed-in OpenWaggle user.
_Avoid_: machine ID, implicit named profile, hardware fingerprint

**CLI client profile revocation**:
The emergency invalidation of a CLI client profile, its live connections, and every active or queued authority chain derived from it without deleting the sessions or transcripts it created.
_Avoid_: ceiling reduction, session deletion, credential rotation

**Profile-management envelope**:
The maximum capabilities, targets, and Authorization ceiling within which a named caller holding `access:profiles` may administer other restricted CLI profiles.
_Avoid_: unrestricted profile admin, caller policy, session grant

**Same-user hostile-process boundary**:
The explicit limit of CLI client profile isolation: OpenWaggle does not claim to contain a hostile process that already has unrestricted access to the user's account, processes, filesystem, and credential material.
_Avoid_: local sandbox, profile escape guarantee, OS-user isolation

**Bundled CLI shim**:
The user-installed `openwaggle` command that delegates to the exact packaged OpenWaggle executable and version that owns the Session Host protocol.
_Avoid_: standalone npm CLI, copied Electron binary, shell alias

**Session Host handoff**:
The negotiated drain and ownership transfer from an idle older Session Host to a compatible newer installed version.
_Avoid_: force restart, parallel host, app relaunch

**Session Host loss**:
The unexpected termination of the Session Host that interrupts owned live runs without proving whether their external side effects completed.
_Avoid_: run failure, graceful shutdown, host handoff

**Session Host cutover migration**:
The one-time alpha migration that builds and validates the complete canonical Session Host database from the previous OpenWaggle database, then atomically installs it without maintaining legacy read or write paths.
_Avoid_: lazy backfill, dual read, compatibility shim, database reset

**Session Host cutover change**:
The single integration pull request and alpha release that removes the development gate and ships the Session Host, full migration, Session Control adapters, Codex-parity surfaces, documentation, and complete verification together.
_Avoid_: feature train, partial rollout, permanent feature flag, compatibility release

**Pre-cutover recovery copy**:
The previous canonical OpenWaggle database retained after successful Session Host migration until the user explicitly removes it, used only by an explicit loss-aware recovery operation.
_Avoid_: automatic rollback, live replica, legacy read store

**Session capability grant**:
A caller-, operation-, workspace-, ancestry-, and target-bound authorization to use Session Control without inheriting another session's permissions.
_Avoid_: desktop session permission inheritance

**Follow-up queue**:
The durable ordered session-owned collection of messages waiting to start new runs after the active run reaches an eligible delivery boundary.
_Avoid_: Pi queue, renderer queue, steering queue

**Follow-up message**:
Input retained outside the active run in the Follow-up queue for later delivery as a new run.
_Avoid_: steering message, deferred steer

**Run start**:
An operation that begins a new run from submitted input while the target session is idle.
_Avoid_: send, resume

**Message submission**:
The state-adaptive default operation that either starts an idle session run or appends a Follow-up message without altering an active run.
_Avoid_: steer, replace, ambiguous send

**Steering message**:
Input addressed to a specific active run for incorporation at its next safe model boundary without cancelling the run or creating a new turn.
_Avoid_: replacement prompt, queued follow-up, cancel-and-restart steering

**Steering promotion**:
An operation that converts one selected Follow-up message into a Steering message for the targeted active run.
_Avoid_: queue promotion, move to front

**Run replacement**:
An explicit operation that cancels a targeted active run and starts a new run from replacement input.
_Avoid_: steering message, interrupt

**Run interruption**:
An explicit operation that cancels a targeted active run without starting another run.
_Avoid_: pause, replace, steer

**Descendant interruption**:
An explicit operation that interrupts selected active child runs or all active descendants of a parent without changing the durable identity of any involved session.
_Avoid_: parent interruption, profile revocation, session deletion

**Follow-up withdrawal**:
An operation that removes one or more selected Follow-up messages before delivery.
_Avoid_: interrupt, dismiss notification

**Follow-up reordering**:
An operation that changes the relative delivery order of pending Follow-up messages.
_Avoid_: steering promotion, replace

**Follow-up queue pause**:
A state that retains pending Follow-up messages while preventing their automatic delivery.
_Avoid_: interrupt, clear queue

**Follow-up queue resumption**:
An explicit operation that makes a paused Follow-up queue eligible to deliver its next message.
_Avoid_: run start, retry

**Follow-up authorization block**:
The needs-attention state of a Follow-up message whose requested Run authorization override is no longer permitted when delivery is about to create its run.
_Avoid_: silent downgrade, failed message, expired follow-up

**Expected run identity**:
The caller-supplied identity of the active run that a run-control operation is allowed to mutate.
_Avoid_: current run hint, session ID

**Follow-up identity**:
The stable identity of one message in a Follow-up queue across callers, retries, and process restarts.
_Avoid_: array index, renderer key

**Follow-up queue revision**:
The monotonic version of a Follow-up queue required to guard operations that mutate queue-wide state or ordering.
_Avoid_: message count, updated timestamp

**Mutation idempotency key**:
The caller-selected retry identity that makes repeated execution of the same authorized mutation produce at most one effect and replay its outcome.
_Avoid_: follow-up identity, request identity, request timestamp

**Follow-up intent snapshot**:
The durable non-authority message content and turn intent captured when a Follow-up message is accepted.
_Avoid_: queue payload, execution profile snapshot

**Target execution profile**:
The target session's effective model, project, tools, MCP, filesystem, network, approval, and credential configuration resolved when a run starts.
_Avoid_: caller profile, inherited permissions

**Message provenance**:
The immutable OpenWaggle-authored attribution that identifies the origin, caller, source session and run, delivery action, and acceptance time of submitted input.
_Avoid_: caller-supplied attribution, message prefix

**OpenWaggle extension package**:
A first-class local package that can add OpenWaggle desktop contributions and optionally Pi runtime resources.
_Avoid_: plugin, addon

**Development extension fixture**:
An extension package used only for local QA, tests, or demos and never shipped as product content.
_Avoid_: bundled extension

**Extension authoring root**:
A user-writable extension package directory exposed by installed OpenWaggle so users and agents can create or modify extension packages.
_Avoid_: development fixture directory, bundled extension directory

**OpenWaggle desktop contribution**:
A declared addition to an OpenWaggle-owned product surface.
_Avoid_: widget, plugin component

**Agent-loop contribution**:
An OpenWaggle desktop contribution that renders or collects feedback during an active Pi agent loop.
_Avoid_: OpenWaggle tool runtime, custom loop

**Display-only agent-loop contribution**:
An Agent-loop contribution that renders Pi agent-loop progress or results without collecting user feedback.
_Avoid_: passive tool

**Interactive agent-loop contribution**:
An Agent-loop contribution that renders a pending Pi interaction and returns a typed user response to the Pi agent loop.
_Avoid_: direct Pi mutation, renderer callback

**Pi interaction primitive**:
A Pi-native user interaction request such as confirm, select, input, editor, notify, or typed custom.
_Avoid_: extension-defined modal protocol

**Extension interaction schema**:
The public typed request-and-response contract for rendering Pi interaction primitives in OpenWaggle.
_Avoid_: undocumented payload shape

**Agent-loop event DTO**:
An OpenWaggle public data shape that preserves Pi agent-loop semantics for extension renderers without exposing Pi package internals.
_Avoid_: raw Pi SDK type in renderer

**Custom desktop interaction**:
A typed OpenWaggle rendering of a Pi custom interaction request for cases not covered by standard Pi interaction primitives.
_Avoid_: Pi TUI component in Electron

**Agent-loop fallback renderer**:
An OpenWaggle-owned renderer used when an Agent-loop contribution is missing, disabled, unsupported, or fails.
_Avoid_: silent failure, hanging tool UI

**Agent-loop binding identity**:
The Pi-native tool name or custom message type that an Agent-loop contribution renders.
_Avoid_: renderer-only event name, OpenWaggle tool id

**Extension contribution surface**:
The OpenWaggle-owned place where an extension contribution appears, such as a route, side panel, dialog, settings section, transcript card, or status widget.
_Avoid_: lane, slot

**Extension contribution container**:
The OpenWaggle-owned shell around mounted extension content, including placement, chrome, sizing, docking, and persistence rules.
_Avoid_: extension-owned shell

**Extension contribution runtime**:
The execution model OpenWaggle uses to load and mount a visual extension contribution.
_Avoid_: lane

**Extension execution placement**:
The runtime location where a visual extension contribution runs, such as the OpenWaggle renderer or an isolated frame.
_Avoid_: trust level

**Federated module runtime**:
The default visual extension contribution runtime where OpenWaggle loads an extension-provided module at runtime and gives it a mount context.
_Avoid_: trusted-react as the general term

**Extension mount context**:
The object OpenWaggle passes to a federated module so it can attach UI to a host-provided root and use the public extension SDK in any execution placement.
_Avoid_: props, renderer internals

**Composer extension surface**:
An OpenWaggle-owned compact composer-adjacent action surface for extension controls such as buttons, selectors, or launchers.
_Avoid_: arbitrary composer injection

**Composer add menu**:
The composer `+` menu that exposes attachment, project-file reference, skill, and Waggle entry points. Each entry opens the existing composer-native flow and produces the same draft node and message metadata as its keyboard-driven equivalent.
_Avoid_: second attachment flow, second mention picker, duplicate skill or Waggle state

**Slash command menu**:
The composer-native chooser for skills, one-shot Waggle presets, and slash commands. The `/` invocation character is stable prompt syntax rather than a configurable application shortcut.
_Avoid_: command palette, search palette

**File mention menu**:
The composer-native chooser opened by the stable `@` invocation character to reference project files in a prompt.
_Avoid_: project file picker, configurable application shortcut

**Global command palette**:
The app-wide modal chooser for navigation and product actions, including session creation, project switching, file/content search, settings, session operations, extension surfaces, recent sessions, and feedback. It does not contain prompt skills, Waggle presets, or slash commands.
_Avoid_: Slash command menu, composer palette

**Shortcut registry**:
The persisted, conflict-free mapping from product commands to user-recorded cross-platform key combinations. Core navigation commands remain assigned but can be remapped; optional workspace commands can be cleared or reset.
_Avoid_: component-local shortcut literal, silent shortcut replacement

**Waggle invocation**:
An explicit, one-shot user or standard-agent request to run a saved Waggle preset for one prompt. A Waggle invocation cannot start another Waggle while collaboration is already active.
_Avoid_: hidden mode toggle, implicit collaboration

**Waggle handoff**:
A terminating transition from the standard agent to a Waggle invocation after the current turn settles. The collaboration reuses the same session context and returns control when it finishes. An agent-triggered handoff is a visible Pi tool invocation and does not add a separate confirmation step.
_Avoid_: parallel transcript copy, nested Waggle run

**Waggle execution bar**:
The transient status toolbar above the composer while a Waggle invocation is pending or running. It disappears when the invocation completes, stops, is cancelled, or fails.
_Avoid_: Waggle mode toolbar, ready banner

**Workspace file surface**:
The route-backed right-side file browser, preview, and editor opened from project file search or file links. It supports optimistic edits with visible save state while keeping filesystem authority in the main process.
_Avoid_: read-only attachment preview, renderer filesystem access

**Transcript agent-loop surface**:
The durable chat-transcript surface for rendering Pi tool progress, tool results, approvals, and custom agent-loop messages.
_Avoid_: ephemeral-only tool UI

**Blocking agent-loop interaction**:
An Interactive agent-loop contribution that pauses agent progress until the user responds.
_Avoid_: hidden prompt

**Authorization request**:
A blocking request for the user to grant or deny a clearly identified agent capability within an explicit scope.
_Avoid_: generic confirmation, interaction requested, Pi permission

**Authorization mode**:
The global, project, or session preference that determines whether authorization requests are granted automatically or presented to the user.
_Avoid_: permission level, sandbox mode, interaction mode

**Authorization mode override**:
An explicitly chosen Authorization mode at project or session level that replaces the inherited default until it is cleared.
_Avoid_: copied default, session mode snapshot, birth-time mode

**Run authorization override**:
An Authorization mode requested only for one newly created run and inherited by descendants of that run, always bounded by its Authorization ceiling and never persisted as a session default.
_Avoid_: session override, permanent YOLO, caller permission

**Draft authorization override**:
An explicit Authorization mode choice made before a draft has a durable session. It is persisted as that session's Authorization mode override before the first task is launched; absence means the draft still inherits.
_Avoid_: copied default, disabled first-run control, implicit session snapshot

**Effective authorization mode**:
The Authorization mode a run actually uses, resolved when an authorization request occurs from the nearest Authorization mode override and otherwise from the global default, then clamped by the run's Authorization ceiling.
_Avoid_: stored session mode, snapshotted mode

**Authorization ceiling**:
The most permissive Authorization mode a Local-user identity, CLI client profile, or derived spawn grant may apply to a run, regardless of a more permissive inherited default or requested runtime override.
_Avoid_: session default, approval grant, sandbox mode

**YOLO (Full Access)**:
The default Authorization mode that automatically grants a request only when the agent asks to act itself inside the current workspace and session.
_Avoid_: YOLO mode, no-safety mode, auto-answer mode, unrestricted mode

**Request purpose**:
The declared category of a blocking request — authorization, user input, disclosure, or external navigation — that decides whether an Authorization mode may answer it without the user.
_Avoid_: interaction kind, confirm title, inferred intent

**Ask for Approval**:
An Authorization mode that presents an authorization request when no matching scoped grant already exists.
_Avoid_: Ask mode, manual mode, confirmation mode

**Scoped authorization grant**:
A revocable authorization bound to one project, requester, capability, and resource or destination. The requester is identified by its stable id, not by its display name, so renaming it neither drops the grant nor lets a reused name inherit one.
_Avoid_: blanket permission, global allow, trusted requester

**Authorization decision**:
The outcome of an Authorization request: continue without access, allow once, allow for the session, or create a Scoped authorization grant.
_Avoid_: interaction response, confirmation result, approval boolean

**Authorization history entry**:
The single durable transcript record that presents an Authorization request and its eventual Authorization decision in user-facing language.
_Avoid_: request card, resolved card, raw interaction event

**Agent notification**:
A non-blocking, attributed message from an agent run with informational, warning, or error severity that never requires a user response.
_Avoid_: interaction request, approval, acknowledgement prompt

**Notification stack**:
The floating, corner-anchored presentation of the current session's Agent notifications, ordered by severity, collapsed to a peek behind the frontmost notice and expanded on hover.
_Avoid_: composer banner, interaction card, application-wide toast, notification side panel

**Durable notification notice**:
The single semantic transcript record retained for a warning or error Agent notification.
_Avoid_: notification request card, notification resolution card, raw notification event

**Composer draft continuity**:
The guarantee that an arriving agent request adds a surface above the composer without changing the composer itself, so the user can finish and send the thought they were already writing.
_Avoid_: approval takeover, disabled composer, focus steal, placeholder swap

**Extension SDK surface**:
The intentional public API exposed to extension code for capability calls, UI mounting context, theme data, and contribution behavior.
_Avoid_: OpenWaggle internals, renderer internals

**Extension SDK package**:
The author-facing OpenWaggle publishable package that distributes extension mount context types, broker SDK helpers, public schemas, theme helpers, UI helpers, and agent-loop DTOs.
_Avoid_: renderer component library, Electron IPC package, OpenWaggle internals package

**Extension React package**:
The optional OpenWaggle publishable package that provides React component primitives for extension authors.
_Avoid_: core extension SDK package, required UI dependency

**Extension React primitive**:
A small theme-aligned React component exported by the Extension React package for extension settings, forms, status, or surface layout.
_Avoid_: OpenWaggle renderer component, full design-system replacement

**Extension UI style contract**:
The framework-neutral class, data-attribute, CSS-variable, and stylesheet contract shared by Extension SDK helpers and Extension React primitives.
_Avoid_: OpenWaggle app CSS import, Tailwind dependency

**Canonical package source**:
The single source location that both OpenWaggle itself and package consumers use for a publishable package's public API.
_Avoid_: copied package source, app-only source mirror

**Public boundary schema**:
A runtime validation schema for a public OpenWaggle package contract that consumers can use to validate values before sending them to OpenWaggle or Pi.
_Avoid_: internal service schema, app store schema

**Package runtime dependency**:
A dependency that is required when a published OpenWaggle package runs in a consumer project.
_Avoid_: hidden peer requirement, bundled app dependency

**Package peer dependency**:
A dependency that a consumer project must provide for an OpenWaggle publishable package integration to run correctly.
_Avoid_: bundled dependency

**Package engine baseline**:
The minimum Node.js version supported by OpenWaggle publishable packages.
_Avoid_: desktop app Node constraint

**Package namespace**:
The npm scope that owns OpenWaggle publishable package names.
_Avoid_: temporary publish scope, personal npm scope

**Package publish validation**:
The required checks that prove a publishable package can be built, packed, installed, imported, and safely published.
_Avoid_: app release validation

**Package provenance gate**:
A publish validation gate that proves the workflow is using the expected GitHub OIDC trusted-publishing identity before any package is published.
_Avoid_: ambiguous npm auth state

**Trusted package publish**:
The direct publication of an exact validated package tarball through the authorized GitHub OIDC workflow.
_Avoid_: staged package publish, token publish

**Package namespace bootstrap**:
The one-time creation of non-default npm package placeholders required before Trusted Publishing can be configured.
_Avoid_: initial public package release, local release fallback

**Package publish event**:
The Release Please-created release or exact recovery tag that authorizes a Trusted package publish.
_Avoid_: arbitrary manual publish run, branch-head publish

**Package manager smoke test**:
A package publish validation check that installs a packed package with a supported package manager and verifies imports, requires, and types.
_Avoid_: workspace-only import test

**Package API snapshot**:
A committed snapshot of a publishable package's public TypeScript declaration surface used to detect unintended API changes.
_Avoid_: informal API review only

**Package API snapshot check**:
The validation step that compares built package declarations against committed Package API snapshots.
_Avoid_: manual declaration diff

**Package changelog**:
A changelog scoped to one OpenWaggle publishable package and maintained by the package publishing workflow.
_Avoid_: root app changelog entry for package-only changes

**Package release commit**:
A release-eligible Conventional Commit that touches one OpenWaggle publishable package path.
_Avoid_: app release intent, scope-only package claim

**Package release PR**:
The coordinated Release Please pull request that records pending versions and changelogs for one or more independently versioned packages.
_Avoid_: ordinary feature PR, desktop release PR

**Package README**:
A concise, hand-maintained package-local consumer entry point with install commands, imports, quick examples, and links to canonical docs.
_Avoid_: full product docs

**Package release tag**:
A short package-name Git tag scoped to one OpenWaggle publishable package version, such as `extension-sdk-v0.1.0`.
_Avoid_: desktop app release tag

**Package GitHub release**:
A GitHub Release scoped to one OpenWaggle publishable package version and its package release tag.
_Avoid_: combined package release, desktop app GitHub release

**Package documentation page**:
A website documentation page that comprehensively explains an OpenWaggle publishable package.
_Avoid_: package README as the only documentation

**Packages documentation section**:
The openwaggle.ai documentation section under `website/src/content/docs/packages/` that explains available OpenWaggle publishable packages and how to use them.
_Avoid_: hiding package docs inside unrelated extension docs

**Waggle core package**:
The runtime-agnostic OpenWaggle publishable package for Waggle mode policy that can be reused outside Pi.
_Avoid_: Pi adapter package, desktop app package

**Pi Waggle package**:
The Pi-specific OpenWaggle publishable package that includes Waggle core policy and exposes Waggle mode to Pi users through one installable package.
_Avoid_: core policy package, desktop app package

**Extension author documentation**:
User-facing documentation for humans building OpenWaggle extension packages.
_Avoid_: ADR-only extension docs

**Agent-facing installed documentation**:
Build-produced package-local docs for self-modifying agents inspecting an installed OpenWaggle.
_Avoid_: hand-maintained duplicate docs

**Installed docs index**:
A generated entry point that maps common agent questions to package-local OpenWaggle and Pi documentation paths.
_Avoid_: hidden docs tree

**Docs discovery capability**:
A typed OpenWaggle capability that resolves installed and discovered documentation topics to local documentation paths and lightweight provenance metadata.
_Avoid_: hardcoded docs path, hidden local docs

**Docs discovery topic**:
A first-party typed topic that identifies an OpenWaggle or Pi documentation entry.
_Avoid_: free-form docs query

**Extension package documentation**:
Package-local documentation shipped by an OpenWaggle extension package in a Pi-style `docs/` directory.
_Avoid_: first-party docs override

**Self-modifying agent context**:
OpenWaggle-provided context that lets an agent inspect and change OpenWaggle itself using installed product documentation and runtime contracts.
_Avoid_: hidden self-knowledge

**OpenWaggle shared extension module**:
An optional host-provided module an extension can import for SDK, theme, or UI convenience when using a federated module runtime.
_Avoid_: required framework dependency

**OpenWaggle publishable package**:
A public npm package maintained by OpenWaggle for extension authors, runtime integrations, or reusable Waggle policy.
_Avoid_: app artifact, development fixture, internal workspace-only package

**Package publishing workflow**:
The shared release path used to validate, package, and publish OpenWaggle publishable packages.
_Avoid_: ad hoc publish, one-off package release

**Release Please package workflow**:
The Package publishing workflow based on Release Please manifest mode, path-scoped Conventional Commits, package-specific changelogs, validated tarballs, and Trusted package publish.
_Avoid_: Changesets workflow

**App release workflow**:
The release path that publishes OpenWaggle desktop app artifacts and update metadata.
_Avoid_: npm package publishing workflow

**Dual package output**:
A package distribution shape that publishes both ESM imports and CommonJS require entry points, plus TypeScript declarations.
_Avoid_: raw TypeScript exports, ESM-only package output

**Plain TypeScript package build**:
A package build that uses TypeScript project builds to emit ESM, CommonJS, and declarations without bundling dependencies.
_Avoid_: tsup build, Rollup build, Vite library build

**Package export boundary**:
The explicit `package.json` exports that define every supported public import path for an OpenWaggle publishable package.
_Avoid_: deep dist import, deep source import, undocumented subpath import

**Package side-effect metadata**:
The `package.json` tree-shaking hint that marks whether package imports can be removed safely when unused.
_Avoid_: implicit bundler behavior

**Package publish access**:
The `package.json` `publishConfig.access` declaration that marks a scoped OpenWaggle publishable package as public.
_Avoid_: implicit scoped package access

**Package tarball contents**:
The files intentionally included in a published npm tarball for an OpenWaggle publishable package.
_Avoid_: repository source tree, workspace package directory

**Package import boundary check**:
A repository standards check that rejects forbidden imports inside OpenWaggle publishable package source.
_Avoid_: review-only package boundary

**Independent package version**:
A package-specific semver version that advances only when that package's public contract changes.
_Avoid_: lockstep app version

**Dependent package bump**:
A package version change caused by updating its dependency on another OpenWaggle publishable package.
_Avoid_: unrelated lockstep release

**Published package dependency range**:
The semver range written into a packed or published OpenWaggle package manifest for another OpenWaggle publishable package.
_Avoid_: workspace dependency in npm tarball, exact lockstep dependency

**Initial public package version**:
The first npm-published semver version for an OpenWaggle publishable package.
_Avoid_: workspace placeholder version

**Extension capability broker**:
The main-process authorization boundary for extension calls into OpenWaggle capabilities.
_Avoid_: direct IPC, direct store access

**OpenWaggle state read capability**:
A fully typed public SDK capability that lets extension code read or subscribe to selected OpenWaggle state without importing internal stores.
_Avoid_: direct OpenWaggle store access

**OpenWaggle action capability**:
A fully typed public SDK capability that lets extension code request an OpenWaggle behavior change without writing internal stores.
_Avoid_: writable OpenWaggle store access

**Extension package state**:
Extension-owned reactive in-memory state shared across all contributions from the same OpenWaggle extension package.
_Avoid_: global app store

**Extension contribution instance state**:
Extension-owned state scoped to one mounted contribution instance.
_Avoid_: package state

**Agent-loop durable state**:
Pi session data that can reconstruct historical agent-loop contributions after remount, route change, or app restart.
_Avoid_: renderer-only history

**Pending interaction state**:
OpenWaggle-owned live state for an interaction request waiting for user feedback.
_Avoid_: extension-local pending prompt

### Source control and diff

**Source control provider**:
An integrated remote hosting service OpenWaggle drives for change requests and remote refs, such as GitHub or GitLab.
_Avoid_: git remote (that is the plain URL), forge

**Change request**:
The provider-neutral concept that a GitHub pull request or a GitLab merge request instantiates.
_Avoid_: PR (as the neutral term), MR (as the neutral term)

**Stacked git action**:
A single composite git intent that runs an ordered set of steps — for example commit, then push, then open a change request — as one user action.
_Avoid_: batch commit, macro

**Local VCS status**:
The network-free part of a repository's git status — repo presence, current ref, default-ref and primary-remote flags, and working-tree changes — that the diff panel can read instantly.
_Avoid_: git status (unqualified)

**Remote VCS status**:
The network-derived part of a repository's git status — upstream presence, ahead/behind and ahead-of-default counts, and open change-request state — loaded asynchronously.
_Avoid_: git status (unqualified)

**Working-tree diff**:
The diff scope showing staged and unstaged changes in the current working tree.
_Avoid_: local diff, dirty diff

**Branch diff**:
The diff scope comparing the current branch against a chosen base ref.
_Avoid_: PR diff, full diff

**Branch-diff base ref**:
The ref the Branch diff compares against; chosen in the diff panel, changeable at any time, and view-only (it never alters the repository or a Session worktree).
_Avoid_: base ref (unqualified), worktree base ref

**Worktree base ref**:
The ref a worktree-backed Workspace resource is forked from when it is materialized; chosen before creation and frozen as Workspace birth provenance. It records where that Workspace came from and is **not** a claim about which branch is checked out now.
_Avoid_: base ref (unqualified), branch-diff base ref, start branch, current branch

**Turn diff**:
The diff scope showing working-tree changes observed between one Pi agent turn's Workspace snapshots. It is ordinary turn attribution when no other writer overlaps and is explicitly shared-concurrent observation when runs overlap in one Workspace.
_Avoid_: message diff, step diff

**Turn checkpoint**:
A persisted snapshot of a bound Workspace's file state captured per Pi agent turn, stored with session, run, Workspace, and overlap attribution and queryable by turn range to produce Turn diffs.
_Avoid_: Pi session snapshot (that is conversation state), autosave

**Session worktree**:
A managed git worktree backing one Workspace resource. One or more sessions may bind to it, and its path and branch derive from the stable Workspace identity rather than any member session. A branch changed underneath it — by an agent or terminal — is not inferred as new birth provenance.
_Avoid_: branch (ambiguous here), session branch, checkout

**Workspace resource**:
The stable OpenWaggle identity for one execution working tree: either the project's primary local checkout or a managed Session worktree, together with its repository, path, git birth provenance, lifecycle, and session memberships.
_Avoid_: session, project, process cwd, conversation branch

**Workspace binding**:
The durable membership that makes one Workspace resource the Working path for a session until that session explicitly changes placement or releases it.
_Avoid_: copied path, worktree owner, session folder

**Spawn workspace selection**:
The explicit `share-parent`, `new-worktree`, or `local` choice that binds a spawned child to the parent's exact Workspace resource, a newly created managed Workspace, or the project's primary checkout Workspace.
_Avoid_: environment inheritance, copied checkout, worktree mode flag

**Launch workspace selection**:
The `current`, `new-worktree`, `local`, or explicit authorized Workspace choice that binds a launched independent root without implying Spawn lineage.
_Avoid_: share-parent, root isolation mode, implicit new worktree

**Working path**:
The filesystem path of the Workspace resource currently bound to a session. Distinct from the project path, which identifies the repository and still keys repository-level data such as branch lists, worktree lists, and remotes.
_Avoid_: project path (that is the repository), cwd, workdir

**Session environment mode**:
The `local` or `worktree` kind of the Workspace resource currently bound to a session; it describes placement, not exclusive ownership.
_Avoid_: sandbox, isolation level

**Work-locally fallback**:
The first-send transition that changes a session from `worktree` to `local` while continuing its already-submitted turn exactly once in the opened checkout.
_Avoid_: retry locally, local copy, second send

**Worktree launch progress**:
The app-owned, reconnectable projection of first-send worktree orchestration before Pi starts. It reports only operations OpenWaggle is actually performing and collapses into a Worktree launch trace when the task starts streaming.
_Avoid_: agent phase, simulated progress, fixed-duration setup animation

**Worktree launch trace**:
The durable, compact transcript activity left after successful worktree creation. It reads `Worktree created` and can disclose the actual retained worktree output without keeping the full launch panel in the conversation.
_Avoid_: vanished setup event, permanent progress panel, assistant message

**Failed worktree launch**:
A recoverable Worktree launch progress state that retains exactly one submitted turn and exposes its actual failure details until the user retries, continues locally, or cancels and restores the draft.
_Avoid_: generic send error, duplicate draft, automatic local fallback

### Appearance and design tokens

**Design token contract**:
The single versioned set of semantic presentation roles — colour, typography, spacing, radius, shadow, and focus — published by the extension SDK and consumed by both the OpenWaggle app and extensions, so host and extension UI cannot drift apart and a user-authored Appearance overrides one standard-shaped surface.
_Avoid_: theme (that is an instance), CSS variables (that is the transport), design system (broader than the token set)

**Appearance**:
A named instance of the Design token contract that a user can select, such as dark or light.
_Avoid_: theme (ambiguous with the extension theme object), skin

**Colour scheme**:
The light-or-dark polarity flag carried inside an Appearance, used by consumers that only need to know the polarity rather than individual role values.
_Avoid_: appearance (that is the full instance), mode (ambiguous with Session environment mode)

**Semantic role**:
One named entry in the Design token contract, such as `surfaceRaised` or `textMuted`, defined by the meaning of its use rather than by a literal value.
_Avoid_: variable, colour name, palette entry

**Derived token**:
An OpenWaggle-internal presentation value computed from Semantic roles for a specific surface, such as the diff panel's add/remove colours, kept out of the public contract while still re-theming automatically.
_Avoid_: private token (it is still a CSS variable), one-off colour

**Type scale**:
The Design token contract's text steps are Tailwind's standard `text-*` scale (xs through 2xl), exposed as themeable variables so utilities consume them and an Appearance can override them. The app uses the standard steps and adds no bespoke sizes.
_Avoid_: arbitrary text size, bespoke text role, text-[Npx]

**Spacing scale**:
The Design token contract's spacing is Tailwind's standard spacing unit, exposed as a themeable variable; every spacing and sizing utility derives from it on the numeric grid. There is no second spacing vocabulary.
_Avoid_: arbitrary spacing value, bespoke spacing role, p-[Npx]

**Radius scale**:
The Design token contract's radius steps are Tailwind's standard `rounded-*` scale, exposed as themeable variables. The app uses the standard steps and adds no bespoke radii.
_Avoid_: arbitrary radius, rounded-[Npx], panel radius

**Changed-file navigator**:
The diff panel's list of files in the active diff scope, used to jump to a file's section and to submit a review.
_Avoid_: worktree sidebar (worktree means a git worktree here), file tree (it is scoped to changed files, not the repository), sidebar (that is the app-level surface)

**Session context row**:
The pre-launch row stating which project, environment, and ref the first send will use. Its **Project picker**, **Session environment mode**, and **Run target picker** remain separate controls. Deliberately one fixed-height row, so changing mode never shifts the composer. After first send it collapses out of the composer; the transcript's worktree-launch trace records worktree creation when applicable.
_Avoid_: branch toolbar, composer context strip, Composer extension surface (that is for extension controls)

**Project picker**:
The selection-only chooser for the project a draft session belongs to. It offers known recent projects and the operating-system folder chooser, and remains distinct from **Session environment mode** and **Run target**.
_Avoid_: environment picker, run target picker, repository picker

**Run target**:
The ref the next send will run on. In `local` mode that is the checked-out branch; in `worktree` mode it is the **Worktree base ref** the new worktree branches from. One name for one question, because showing the same branch string in two controls left it ambiguous which governed the send.
_Avoid_: current branch (only true in local mode), base branch (only true in worktree mode), run context

**Run target picker**:
The selection-only ref chooser in the **Session context row**. Selecting an existing ref resolves against the **Session environment mode**: it checks the ref out in `local` mode and records it as the **Worktree base ref** in `worktree` mode.
_Avoid_: branch picker (it picks a run target, not a branch to manage), branch manager, Options popover (removed)

**Syntax theme**:
The token-colour scheme applied to code text inside a diff (keyword, string, comment, and so on), supplied by the diff renderer and selectable by the user. It is deliberately **not** part of the Design token contract: its taxonomy is language grammar scopes, not semantic presentation roles.
_Avoid_: Appearance (that governs chrome, not code tokens), colour scheme, palette

**Syntax theme preview**:
The live patch rendered inside the Syntax theme picker, using the real renderer and the real Diff chrome, so the choice is made by looking rather than by reading a description.
_Avoid_: sample, thumbnail (it is a working diff, not an image), swatch

**Diff chrome**:
Everything the diff renderer draws around the code text — gutters, line numbers, add/remove backgrounds, word-level emphasis, hover, selection, separators. Unlike the Syntax theme, the diff chrome is driven by OpenWaggle Semantic roles (as Derived tokens), so it always matches the active Appearance.
_Avoid_: diff theme (ambiguous with Syntax theme), diff style (that is unified-vs-split)

**Hunk**:
A contiguous block of changed lines within a file diff, introduced by an `@@` header. The unit the renderer groups changes into; used in code and docs but not in button labels.
_Avoid_: chunk, block, section

**Diff view**:
The layout the diff is drawn in — unified (one column) or split (side-by-side). A user-selectable Diff view setting.
_Avoid_: diff mode (ambiguous with Session environment mode), stacked (reads as a third mode rather than a synonym for unified)

**Review comment**:
A piece of feedback a user anchors to a line or line range in the Changed-file navigator's diff, addressed to the agent rather than to a remote change request. Carries the anchored diff snippet so the agent sees the code being discussed.
_Avoid_: inline comment (that is the UI affordance), change-request comment (that targets a PR/MR)

**Review**:
The set of pending Review comments plus an optional Review summary, accumulated in the diff panel and submitted to the agent as one message. Pending until submitted; discarding clears it without sending.
_Avoid_: batch, PR review (no remote change request is involved)

**Review summary**:
An optional overall instruction attached to a Review at submit time, framing the individual Review comments for the agent.
_Avoid_: description, cover letter, global comment

### Sidebar quick access

**Pinned session**:
A session the user has explicitly marked for quick access, so it appears in the Pinned section regardless of recency. A durable expression of user intent, not a view preference: it survives archiving the session and is keyed by the session's own identity, so it can later follow the session across devices.
_Avoid_: favourite, starred, bookmark, pinned project (projects cannot be pinned)

**Pinned section**:
The region at the top of the sidebar that lists every Pinned session, above the project list. Its purpose is a predictable location: a Pinned session is always found here rather than wherever recency has moved it.
_Avoid_: pinned band, favourites bar, quick access bar

**Manual order**:
The user-authored sequence of Pinned sessions, produced by dragging rows within the Pinned section and persisted per pin. The default Pinned sort, and the only one whose sequence a user owns; the alternatives derive their sequence from session data instead.
_Avoid_: custom order (ambiguous with the Pinned sort choice), pin order (that is chronological, not user-authored)

**Pinned sort**:
The rule ordering the Pinned section — Manual, or one derived from session data (Recent, Oldest, Name). A view preference, distinct from Manual order, which the derived rules never overwrite.
_Avoid_: sort mode (ambiguous with the project list's own session sort), filter (nothing is hidden)

**Pinned shortcut**:
The keyboard shortcut opening a Pinned session by its **position** in the Pinned section, first row through ninth. Positional by definition, so it re-derives whenever the Pinned sort reorders the list, and rows past the ninth have none.
_Avoid_: pin number (implies a number stored on the pin), session shortcut (any session can be opened; only Pinned sessions get a positional one)

### Transcript window

**Transcript window** is the slice of a session's rows the chat builds on open: the newest 40. **Load earlier** expands it by 100 rows. The window is not a scroll position and is never persisted; it resets to the newest rows whenever the open session changes. See `docs/adr/0022-transcript-opens-from-its-newest-end.md`.

### Sidebar row vocabulary

**Session row state**:
The single thing a session row reports: its **Session status** plus `interrupted`, which is not a status because it is recorded per conversation branch and can accompany any status. Ranked, so a row that needs a person outranks one that is merely busy, and a row shows one state rather than several.
_Avoid_: status (that is the narrower Pi-derived value), failed (the vocabulary is `error`, matching the code)

**Attention tier**:
The group of **Session row states** that need a person: needs input, interrupted, error. Rendered loudly, with a leading border as well as colour so the tier is never carried by colour alone. The in-flight tier recedes and the quiet tier stays quiet.
_Avoid_: urgent, priority, alert (none of these are set by the user or by severity)

**Provenance icon**:
A muted icon on a row's second line saying what *kind* of session it is: its git branch, whether it owns a **Session worktree**, how many **SessionBranches** it has, whether a terminal is alive. A separate family from status icons, sharing no glyph with them, because at the size the second line renders a user reads silhouette rather than detail.
_Avoid_: status icon (that family answers a different question), badge (implies a count or a state)

**State chip**:
A control at the top of the sidebar that narrows the whole tree to one **Session row state**, shown only when something is in that state and always paired with a count. Reaches across every project, so a failed run inside a collapsed project is one click away.
_Avoid_: tab, filter pill, segmented control (it is a toggle, and several can be present without being mutually exclusive of the tree)

**Roll-up pip**:
A counted marker on a project heading reporting a **Session row state** inside it, restricted to the attention and in-flight tiers. Exists so a collapsed project still answers "is there anything in here for me".
_Avoid_: badge, dot (a dot carries no count, and a count is what makes the colour legible)

**Sidebar view preference**:
Sidebar state the user authored and expects to survive a relaunch: the session sort order and which projects are collapsed. Distinct from a **Sidebar filter**, which is discarded on quit.
_Avoid_: sidebar settings (it is not in Settings), layout state (window geometry is a different thing)

**Sidebar filter**:
A narrowing of the sidebar that hides sessions: a **State chip** or the text filter. Never persisted, because a filter that subtracts sessions should not outlive the intent behind it, and an app that opened on an unexplained subset would look broken.
_Avoid_: search (it narrows in place rather than producing results), sidebar view preference (that persists; this does not)

## Relationships

- The **Codex parity baseline** decides defaults and observable semantics wherever Codex has a defined behavior; OpenWaggle-specific behavior may be additive but cannot silently change that default.
- A departure from the **Codex parity baseline** requires an explicit documented incompatibility or an explicit user decision, plus a parity-focused acceptance test.
- Full Codex parity means observable lifecycle, interaction, control, safety, workspace, CLI, and activity behavior; it does not make Codex App Server's evolving wire schema or storage representation OpenWaggle's domain model.
- **Session Control** owns versioned platform-neutral commands, results, events, and capability negotiation; GUI, CLI, MCP, internal Sessions tool, Local Session transport, and any **Codex protocol adapter** translate at its boundaries.
- A **Codex protocol adapter** may claim compatibility only for a declared protocol revision and method subset covered by bidirectional conformance tests; unsupported methods fail explicitly rather than approximating behavior.
- A **Hive** has exactly one **Queen Session** and one or more **Worker Sessions** connected by **Spawn lineage**.
- **Queen Session** and **Worker Session** are user-facing and agent-facing roles, while parent and child remain the precise structural relationship between two Sessions in **Spawn lineage**.
- A **Worker Session** that spawns another Session remains a Worker of the same **Hive** while also becoming that new Worker's parent.
- “Spawn a Hive of N Workers” makes an ordinary root Session the **Queen Session** of N direct Workers, adds N direct Workers when addressed to an existing Queen, and adds N Workers beneath an existing Worker without changing that Worker's role.
- “Create a separate Hive” explicitly requests a new independent root Session rather than extending the current **Hive**.
- Creating a separate **Hive** records its initiating Session in audit provenance but creates no parent relationship or **Derived child-management grant**; later control depends on the initiator's existing cross-session capabilities.

- An **OpenWaggle extension package** declares zero or more **OpenWaggle desktop contributions** across one or more **Extension contribution surfaces**.
- A **Development extension fixture** may be copied into a project for manual QA, but it is not an installed or bundled product extension.
- An installed OpenWaggle app exposes **Extension authoring roots** for user-authored and agent-authored OpenWaggle extension packages.
- A **Development extension fixture** must not be published as an npm package or shipped as production app content.
- An **OpenWaggle desktop contribution** has exactly one **Extension contribution surface**.
- An **Agent-loop contribution** is driven by Pi-native agent-loop events and rendered inside OpenWaggle-owned contribution containers.
- A **Display-only agent-loop contribution** observes Pi agent-loop events without returning feedback.
- An **Interactive agent-loop contribution** returns user feedback to the pending Pi interaction through the **Extension capability broker**.
- An **Interactive agent-loop contribution** renders a **Pi interaction primitive** through an **Extension interaction schema**.
- A **Custom desktop interaction** preserves Pi custom-interaction semantics without executing Pi TUI components in Electron.
- An **Agent-loop fallback renderer** must exist for standard **Pi interaction primitives**.
- A **Custom desktop interaction** uses an **Agent-loop fallback renderer** only to report unsupported or unavailable UI when no matching contribution can render it.
- An **Agent-loop event DTO** preserves **Agent-loop binding identity** while hiding Pi package internals from renderer extension code.
- An **Extension interaction schema** belongs to the public **Extension SDK surface**.
- An **Agent-loop contribution** declares an **Agent-loop binding identity** so Pi TUI and OpenWaggle desktop renderers stay aligned to the same runtime event.
- Multiple **Agent-loop contributions** may share one **Agent-loop binding identity** across different **Extension contribution surfaces**.
- The **Transcript agent-loop surface** is the durable fallback record for agent-loop feedback even when auxiliary surfaces such as dialogs, side panels, or status widgets are also used.
- A **Blocking agent-loop interaction** must be surfaced prominently while preserving a durable record in the **Transcript agent-loop surface**.
- A **Blocking agent-loop interaction** is added above the composer without altering it, so a draft, caret position, placeholder, enabled state, and the Enter key all survive its arrival untouched.
- A user may answer a **Blocking agent-loop interaction** before or after sending a queued message, in either order, and neither choice removes the other.
- Cancelling a run denies its pending **Authorization request** rather than carrying it over, so a later run has to ask again.
- A session has at most one active run and one ordered **Follow-up queue**.
- A **Run start** creates a new run, while a **Steering message** remains inside the targeted active run.
- A **Message submission** performs a **Run start** when the session is idle with no pending Follow-up messages, otherwise it appends a **Follow-up message**.
- A **Message submission** never resumes a paused **Follow-up queue** implicitly.
- A **Message submission** reports whether it produced a **Run start** or **Follow-up message**, together with the resulting run or follow-up identity and queue revision.
- A **Steering promotion** removes only the selected **Follow-up message**, and only after the active run accepts the **Steering message**.
- A **Steering message** inherits the active run's execution profile and carries only compatible conversational content.
- A queued Waggle invocation remains a **Follow-up message** or becomes input to a **Run replacement**; it cannot become a **Steering message**.
- A **Run interruption** never starts a replacement run.
- Normal run completion makes the next **Follow-up message** eligible for a **Run start**.
- A **Run interruption** or terminal run failure causes a **Follow-up queue pause** instead of starting another run.
- A paused **Follow-up queue** requires **Follow-up queue resumption** before automatic delivery continues.
- **Session Control** is the authority for each **Follow-up queue**, and the GUI, CLI, MCP server, and internal agents observe and mutate that same queue.
- A restored **Follow-up queue** retains its pending messages after reload, restart, or crash but begins in **Follow-up queue pause**.
- A **Steering message**, **Steering promotion**, **Run replacement**, and **Run interruption** require an **Expected run identity** that still matches the active run.
- A targeted Follow-up queue mutation addresses a stable **Follow-up identity** rather than a queue position.
- Queue-wide state and ordering mutations require the current **Follow-up queue revision**.
- Repeated submissions with the same **Mutation idempotency key** produce at most one **Follow-up message**.
- Every **Follow-up message** owns a **Follow-up intent snapshot** containing its text, durable attachments, thinking request, standard or Waggle intent, caller identity, timestamps, and idempotency metadata.
- A **Run start** combines the selected **Follow-up intent snapshot** with the current **Target execution profile**.
- Automatic delivery revalidates the originating profile or derived grant before applying a queued **Run authorization override**.
- If that override is no longer permitted, the message remains queued in a **Follow-up authorization block** with structured `authorization_ceiling_changed` state; delivery never silently downgrades, discards, or starts it.
- An authorized caller clears a **Follow-up authorization block** by changing the queued override, restoring sufficient authority, or withdrawing the message.
- A cross-session caller cannot place model, tool, MCP, filesystem, network, approval, or credential overrides inside a **Follow-up intent snapshot**.
- Cross-session and CLI input enters the target agent loop as user-role input with **Message provenance** outside caller-controlled content.
- **Message provenance** is visible to the target model and transcript, with a source-session link only when the viewer may discover that session.
- Caller-authored text cannot alter or impersonate **Message provenance**.
- A **Session capability grant** for `sessions:message` permits **Message submission**, **Run start**, and creation of **Follow-up messages**.
- A **Session capability grant** for `sessions:report` permits writing a **Cross-session report** only to its authorized explicit Session or lineage targets and grants no transcript read, Run control, or Delegation review authority.
- A **Session capability grant** for `sessions:steer` permits **Steering messages** and **Steering promotion** without granting interruption.
- A **Session capability grant** for `sessions:interrupt` permits **Run interruption**, while **Run replacement** requires both `sessions:message` and `sessions:interrupt`.
- A **Session capability grant** for `sessions:queue` permits Follow-up queue inspection and mutation, but reading queued content also requires `sessions:read`.
- A **Session capability grant** for `sessions:organize` is limited to session metadata and worktree organization.
- A **Session capability grant** for `sessions:export` permits export delivery but grants no session, queue, or resource content access by itself.
- Transcript export requires `sessions:export` and `sessions:read`; queued content additionally requires `sessions:queue`, and included resources require their corresponding resource-read grants.
- Writing a **Session export** to a destination requires normal filesystem authorization, while streaming it to stdout still counts as export.
- A **Session capability grant** for `sessions:respond` permits responses to authorized non-approval agent-loop interactions, while `sessions:approve` separately permits delegated Authorization decisions.
- The agent or caller that raised an **Authorization request** cannot approve its own escalation unless its pre-existing **CLI client profile** or derived grant already carries `sessions:approve` for that exact scope.
- A **Session capability grant** for `sessions:authorization` permits setting or clearing a session's persistent **Authorization mode override** within the caller's authorized scope; `sessions:approve` alone never changes that override.
- Setting a session override to **YOLO (Full access)** is stronger than approving one request because it may automatically resolve the current **Authorization request** and subsequent Authorization requests, so `sessions:authorization` is never implied by `sessions:approve`, session ownership, or run ownership.
- A **Run authorization override** is selected when a command creates a run, applies only to that run and its spawned descendants, and requires no persistent session mutation.
- A request for a **Run authorization override** above the caller's **Authorization ceiling** fails explicitly rather than silently downgrading or changing the session's persistent mode.
- The **Sessions CLI** accepts a **Run authorization override** only on `launch`, `spawn`, `start`, `follow-up`, and `replace`, whose successful execution deterministically creates an immediate or future run.
- Adaptive `sessions message` rejects a **Run authorization override** because its active-target resolution may steer the current run or create a future one; callers that require a specific mode use the corresponding explicit command.
- The **Sessions CLI** uses the canonical Session Control action names and never collapses Message submission, Steering message, Run replacement, and Run interruption into an ambiguous send operation.
- `sessions launch` atomically returns an independent root session and its initial run identities, while `sessions spawn` returns the child session, initial run, and Delegation Contract identities and later contract operations use the first-class **Delegations CLI**.
- The **Delegations CLI** exposes `list`, `read`, `submit`, `accept`, `request-revision`, `reopen`, `cancel`, `claim`, `dependency`, `amend`, `conflicts`, and explicit `verify` operations with parent, child, project, state, dependency, and conflict filters where applicable.
- The **Delegations CLI** follows the Sessions CLI's machine-output, cursor, idempotency, stdout, diagnostic, and structured-error contracts.
- `sessions message` exposes adaptive **Message submission**, while `start`, `follow-up`, `steer`, `promote`, `replace`, and `interrupt` preserve their stricter preconditions.
- **Sessions CLI machine output** uses explicit JSON for single responses and JSONL for streams, keeps stdout data-only, sends progress and diagnostics to stderr, and reports stable structured error kinds and exit codes.
- The **Sessions CLI** does not change output semantics merely because a stream is or is not attached to a TTY.
- A messaging command accepts exactly one **Sessions CLI message input** through short text, explicit stdin, a UTF-8 input file, or a typed JSON request, with explicit attachment paths where applicable.
- Missing or conflicting **Sessions CLI message input** fails immediately and never opens an implicit interactive prompt.
- Every mutating **Sessions CLI** command accepts a **Mutation idempotency key**, and Session Control scopes its stored outcome to the caller, operation, and target.
- When a caller omits the key, the **Sessions CLI** generates one, reuses it for retries within that invocation, and reports it in machine output; retrying from another invocation requires explicit reuse.
- The **Local Session transport** verifies the connecting process's OS peer user identity through Unix-domain-socket peer credentials or Windows named-pipe security; a hardware or machine identifier is not an authorization principal.
- A same-user **Sessions CLI** request uses the zero-setup **Local-user identity** unless the caller explicitly selects an optional named **CLI client profile** with `--profile <name>` or `OPENWAGGLE_PROFILE`.
- Repository-controlled configuration cannot select a **CLI client profile**, preventing a project from choosing privileged credentials when a caller enters its workspace.
- A named **CLI client profile** is revocable, non-escalating, capability- and target-scoped, authenticated by local peer identity plus a protected profile credential, and recorded in the operation audit trail.
- The **Local-user identity** permits **YOLO (Full access)** under the user's normal OpenWaggle settings, while a named external **CLI client profile** defaults to an **Ask for Approval** Authorization ceiling.
- A user may explicitly raise a named profile's **Authorization ceiling** to **YOLO (Full access)** for a bounded project, session, or ancestry scope; choosing inherit or requesting YOLO outside that scope remains clamped to **Ask for Approval**.
- Creating a named **CLI client profile** generates a random 256-bit bearer credential, stores only its cryptographic verifier in Session Host persistence, and installs the client secret into the platform credential store or an explicitly selected owner-only credential file.
- Profile secrets never appear in command arguments, repository settings, durable logs, or ordinary command output, and credential rotation does not change the profile's capability policy or audit identity.
- Optional profile creation, scope editing, credential rotation, and emergency revocation live in a collapsed `Restricted CLI profiles` card inside the existing Settings → General → Agent access section.
- Normal **Local-user identity** CLI use never requires opening or completing that profile-management surface.
- The headless **Access CLI** mirrors that surface through `openwaggle access profiles list|create|update|rotate|revoke` for the **Local-user identity** and callers explicitly granted `access:profiles`.
- `access profiles create` and `rotate` require an explicit `--credential-store` or `--credential-file <path>` destination and return only profile identity and destination metadata, never the bearer secret, in normal or machine output.
- Credential-file installation is collision-safe, owner-only, and atomic; it refuses an existing destination unless the caller supplies explicit authorized replacement intent.
- A named caller with `access:profiles` may create or edit only policies that are subsets of its **Profile-management envelope** and cannot change its own capabilities, targets, or Authorization ceiling.
- A named profile may rotate or revoke its own credential, but only the **Local-user identity** may grant, expand, or redelegate `access:profiles`.
- **CLI client profile revocation** immediately rejects and disconnects that profile and cascades through every active run, descendant grant, and pending Follow-up whose authority chain originates from it.
- Cascading revocation interrupts affected runs, attempts cancellation of supported in-flight tools, and pauses affected Follow-up delivery with structured `profile_revoked` state, but cannot promise to undo an external effect already started.
- Revocation preserves sessions, transcripts, lineage, queued intent, and audit history for inspection or explicitly authorized resumption under another profile.
- Optional **CLI client profiles** enforce declared, auditable non-escalation for cooperative callers and callers whose surrounding OS or tool sandbox keeps other profile credentials inaccessible.
- The **Same-user hostile-process boundary** excludes a hostile danger-full-access process from that guarantee; containing it requires an external trust boundary such as a separate OS account, sandbox, container, or repeated user-presence authentication.
- OpenWaggle never describes a profile credential as protection from a process that can already read or impersonate the user's unrestricted local environment.
- The initial **Sessions CLI** is distributed through a **Bundled CLI shim**, keeping its protocol and native runtime aligned with the installed desktop application.
- Installing or removing a **Bundled CLI shim** is an explicit user action and never edits shell startup files silently.
- Session Host clients support the current and previous protocol revisions and negotiate before issuing commands or subscribing.
- An incompatible installed client may perform **Session Host handoff** only after the current host is idle; active work returns an upgrade-pending state and continues under its existing owner.
- Two Session Hosts never own the same persistence store during an upgrade.
- **Session Host loss** marks every previously active run interrupted-by-host-loss, denies its pending authorization requests, and restores its Follow-up queue paused.
- A run interrupted by **Session Host loss** is never replayed automatically; retry requires an explicit authorized mutation from its last durable transcript point.
- Rebuildable semantic preparation and explicitly resumable export work may recover independently because they do not replay agent tool effects.
- Because OpenWaggle is alpha, the **Session Host cutover migration** is a full schema and canonical-data cutover rather than a phased dual-read migration.
- The cutover preserves stable Session, Pi-session, node, branch, and checkpoint identities and all canonical conversation content while rebuilding the complete target relational schema, Workspace resources and bindings, synthetic historical turn attribution, empty legacy Follow-up queues, root lineage, lexical projections, semantic embeddings, vector index, and required relational indexes before the Session Host accepts clients.
- Existing local sessions bind to one local Workspace resource per recorded project path; sessions with the same recorded worktree path bind to one shared managed Workspace resource; an unmaterialized legacy worktree plan becomes its own pending Workspace resource.
- A recorded worktree that is missing on disk remains a missing Workspace resource requiring attention and is never rebound to the local checkout silently.
- The cutover is built side by side, validates foreign keys, uniqueness, row counts, transcript high-water marks, binding cardinality, and search-index consistency, then atomically replaces the active database while retaining one pre-cutover recovery copy.
- A failed **Session Host cutover migration** never opens the partially built target database or mutates the previous database; startup stops with an actionable recovery report.
- The **Session Host cutover migration** runs once per data store and records its completed schema, embedding-model, and vector-index revisions in the migration ledger; ordinary launches never repeat it.
- A failure or user cancellation before atomic installation does not mark the cutover complete and may retry against the unchanged previous database.
- After cutover, only new or changed Session discovery text is embedded incrementally; a future model or index replacement requires its own explicit one-time revision migration rather than silently rebuilding on every launch.
- The selected embedding model and vector runtime ship with OpenWaggle so the full cutover is deterministic and works offline, accepting the installer-size and one-time migration-duration cost.
- Once cutover succeeds, application code contains no legacy database read, write, task, queue, or Workspace fallback path.
- Development may use an internal non-user-facing gate and isolated data roots while the feature is incomplete, but the **Session Host cutover change** removes that gate and all legacy orchestration paths before merge.
- The **Session Host cutover change** is one integration pull request and one alpha release; schema, host, Pi Sessions tool, GUI, CLI, MCP adapter, Agent definitions and import, migration, user documentation, performance gates, deterministic CI, Electron QA, and live-provider release evidence are not split into independently shipped features.
- Reviewable commits and internal implementation slices are permitted inside the pull request, but no partial slice may merge or migrate user data independently.
- Merge readiness requires every Codex-parity acceptance test and the complete Definition of Done; follow-up issues cannot substitute for an agreed capability in the cutover scope.
- A successful cutover retains one **Pre-cutover recovery copy** until the user explicitly removes it; normal Session Host reads and writes never consult that copy.
- `openwaggle recovery status` reports the active database, recovery copy, schema compatibility, timestamps, and sizes without opening either as a second live authority.
- `openwaggle recovery restore-pre-cutover` requires the Session Host to be stopped, an exclusive database lock, and explicit confirmation; machine use requires an equally explicit non-interactive confirmation flag.
- Before restoration, recovery preserves the current Session Host database as a separate timestamped artifact and reports that sessions or mutations created after cutover will not appear in the restored database.
- Recovery never restores automatically after a host crash, run failure, migration-era app crash, or validation error, and an older runtime is never intentionally launched against the new incompatible schema.
- Recovery copy removal is an explicit user operation that reports the exact path and irreversibility before deletion.
- The **Session Host** starts on demand for the first GUI or CLI client and keeps accepted runs alive when the GUI closes.
- The **Session Host** remains alive while a client, run, automatic Follow-up delivery, semantic preparation, export operation, wait, or subscription is active.
- With no client and no active work, the **Session Host** exits after an app-global configurable idle grace period whose product default is five minutes; paused Follow-up queues alone do not keep it alive.
- A headless run with a pending agent-loop interaction remains active in the **Session Host**, and its request appears through subscriptions, GUI reconnection, Session watch, and Sessions CLI request inspection.
- Closing the GUI never answers a pending interaction; an authorized caller responds explicitly through the GUI or **Sessions CLI**.
- A pending agent-loop interaction has no automatic expiry by default and continues to keep its run and the **Session Host** active until it is answered or explicitly interrupted.
- A caller may set a bounded interaction deadline when it launches, starts, or spawns a run; expiry interrupts that run with an explicit interaction-timeout outcome and never synthesizes an answer.
- Electron, CLI, and MCP adapters use the **Local Session transport**, while an agent already running inside the **Session Host** invokes **Session Control** through an injected application port.
- The **Sessions tool** is a new OpenWaggle-owned Pi-native extension capability to implement; it does not depend on Pi exposing Codex's collaboration tools or an existing subagent runtime.
- The Pi adapter registers the **Sessions tool** through Pi's native extension tool surface and injects a capability-scoped Session Control port, preserving Pi tool-call and tool-result event semantics end to end.
- The current externally served MCP `openwaggle_sessions` tool is not the **Sessions tool** and is not a second orchestration authority; it must be migrated into an adapter over Session Control as the new host replaces its direct task and persistence paths.
- The external MCP tool retains the stable `openwaggle_sessions` name while its canonical adapter reports **Session Control contract version** `2` in structured results.
- Contract-v2 `steer` requires an **Expected run identity** and means active-turn Steering message delivery; `replace` explicitly performs interruption followed by a new run.
- A legacy MCP `steer` request that cannot prove contract-v2 intent fails before mutation with `ambiguous_legacy_steer` and migration guidance; OpenWaggle never silently maps the old cancel-and-start meaning to true steering or vice versa.
- Existing MCP discovery, read, creation, and organization requests remain compatible where their semantics are unchanged; every incompatible mutation fails explicitly rather than being guessed from an older payload shape.
- The **Sessions tool** carries the source session and run identity plus its **Session capability grant** into every Session Control operation.
- The Pi runtime injects no separate Delegations tool; the compact **Sessions tool** exposes capability-filtered Delegation operations through the same Session Control port.
- `launch` accepts an initial objective and returns `sessionId` and `runId`, while `spawn` accepts a structured initial **Delegation specification** and returns `sessionId`, `runId`, and `delegationId` after atomic acceptance.
- A child receives a bounded current-contract summary and may use the **Sessions tool** to update claims and state, wait on dependencies, submit evidence, or propose amendments.
- Delegation review operations are absent from the model-facing tool surface unless the caller's derived grant carries `delegations:review` for the exact target.
- **Session creation** returns an idle root identity, **Session launch** returns an independent root and its initial Run identities, and **Session spawn** returns a child and its initial Run identities.
- **Session launch** is atomic so a failed initial **Run start** cannot leave a successfully reported but unintended idle root Session.
- **Session launch** requires both `sessions:create` and `sessions:start`, validated together before mutation, rather than introducing a separate launch capability.
- **Session spawn** is atomic so a failed initial **Run start** cannot leave a successfully reported but unintended idle child session.
- Every **Session spawn** records **Spawn lineage** and returns a **Derived child-management grant** limited to the child and to operations allowed by the spawn authorization.
- Every **Session spawn** creates exactly one **Delegation Contract** whose objective is present at creation; its remaining fields may be completed progressively by authorized participants and the Session Host.
- A **Session creation** or **Session launch** without a parent assignment creates no **Delegation Contract**.
- **Spawn lineage** identifies the parent-child relationship, while the **Delegation Contract** describes the assigned outcome and is independent of the child session's runtime status.
- Objective, deliverables, acceptance criteria, and dependencies belong to one immutable **Delegation specification** revision.
- The spawning parent or another authorized reviewer may create a new **Delegation specification** with a recorded reason, while the child may only propose an amendment.
- Child-managed **Delegation scope claims** remain mutable across specification revisions.
- A new **Delegation specification** is delivered to an active child at its next safe agent-loop boundary, and a post-submission amendment moves the contract to `revision_requested`.
- A **Delegation state** is exactly one of `working`, `waiting`, `needs_attention`, `ready_for_review`, `revision_requested`, `accepted`, or `cancelled`.
- `working` means the child owns unresolved work, `waiting` means a declared external condition is pending, and `needs_attention` means an abnormal stop or failure left the assignment unresolved.
- `ready_for_review` means a result and evidence were submitted, `revision_requested` means an authorized reviewer requested another attempt, `accepted` means an authorized reviewer accepted a submitted outcome, and `cancelled` means the assignment ended without acceptance.
- Child Session idleness and Run activity never determine the **Delegation state** by themselves.
- A child may submit its **Delegation Contract** for review with a result and completion evidence, but it cannot accept its own assignment.
- Every **Delegation submission** has a stable identity and revision number, and its result, evidence, provenance, and review history are immutable.
- **Delegation evidence** is typed as `observed-command`, `workspace-diff`, `artifact`, `source-reference`, or `asserted-note`, and every item distinguishes Host-observed facts from child assertions.
- Acceptance criteria identify their supporting **Delegation evidence**, while large logs and artifacts remain in canonical storage and are included only through bounded authorized references.
- The Session Host validates evidence references and recorded facts without secretly rerunning commands; fresh checks run through a reviewer's ordinary authorized tools and are recorded through an explicit visible **Delegation verification** operation.
- Every **Delegation verification** identifies one exact immutable submission and its specification revision, records reviewer identity and bounded evidence, and never changes the Delegation state or accepts the submission implicitly.
- A Worker cannot verify its own submission through its contribution grant; verification requires the parent's derived review grant or another explicit `delegations:review` grant for that contract.
- Only the spawning parent through its derived grant, or another explicitly authorized user or client, may accept a submitted **Delegation Contract** or request revision.
- Acceptance identifies one exact **Delegation submission** rather than accepting every future revision of the contract.
- Acceptance identifies the exact **Delegation specification** revision evaluated with that submission.
- Reopening an accepted **Delegation Contract** requires a reason, preserves the prior submission and acceptance, and begins a new `revision_requested` cycle whose later evidence is appended in a new **Delegation submission**.
- `cancelled` is terminal; continuing cancelled work requires a new **Session spawn** and **Delegation Contract**.
- A write-capable child declares or updates its intended write **Delegation scope claims** before its first known mutation when possible; an unpredictable assignment may claim its entire Workspace.
- Read **Delegation scope claims** are informational, while overlapping write claims produce durable conflict evidence visible to the parent, affected children, GUI, CLI, and MCP clients.
- A **Delegation claim target** is a normalized exact `workspace-file`, recursive `workspace-tree`, or namespaced `named-resource`; arbitrary globs are not claim targets.
- Workspace-relative claim paths reject absolute paths, parent traversal, and unresolved aliases, and `workspace-tree` target `.` represents the entire Workspace.
- Several precise **Delegation scope claims** express disjoint targets instead of one complex pattern.
- A **Delegation conflict** is `live-overlap` when intersecting write claims target the same Workspace and `merge-overlap` when repository-relative claims intersect across distinct Workspaces of the same repository.
- Workspaces from unrelated repositories do not produce path-based **Delegation conflicts**, while a namespaced logical claim conflicts only within its declared project or repository scope.
- Live and merge overlaps are separately acknowledgeable and remain advisory regardless of severity.
- Conflict discovery is independently paginated and filterable by project, Working path, parent, Worker, Delegation, conflict kind, and `unacknowledged`, `acknowledged`, or `resolved` status without hydrating Session transcripts.
- A **Delegation scope claim** never blocks a write, reserves a resource, grants access, or widens Authorization.
- A known write outside every declared write **Delegation scope claim** is persisted as an **Undeclared write observation** without being prevented.
- Automatic **Undeclared write observations** require exact Worker, Run, path, claim-revision, and provenance attribution; an isolated managed-worktree Turn checkpoint satisfies that requirement.
- A shared or local Workspace diff is not attributed to one Worker when another Session could have produced it, so the Session Host does not create an **Undeclared write observation** from that ambiguous evidence alone.
- An authorized parent may acknowledge an overlap with a recorded reason, preserving the conflict history while marking the concurrency as intentional.
- A **Delegation dependency** targets another Delegation Contract and requires either `ready_for_review` or `accepted`; cycles are rejected.
- **Delegation dependencies** never delay **Session spawn** or create hidden Run scheduling, and a child may begin independent work before they are satisfied.
- A child that cannot progress until a **Delegation dependency** is satisfied may enter `waiting`, and the Session Host notifies subscribed participants when the required condition is reached.
- A dependent contract may submit evidence while a **Delegation dependency** is unsatisfied but cannot be accepted until every required dependency condition holds.
- `delegations:read` permits reading authorized contract state and history, `delegations:contribute` permits authorized participant updates and submissions, and `delegations:review` permits specification amendments and review decisions.
- **Session spawn** creates its **Delegation Contract** under `sessions:spawn` without requiring a redundant create capability.
- The child receives `delegations:contribute` only for its own contract, while the spawning parent's **Derived child-management grant** carries non-escalating `delegations:read` and `delegations:review` only for that contract.
- Delegation capabilities never disclose a linked transcript, queue body, Workspace resource, artifact, or other protected content without that resource's ordinary read capability.
- A named CLI client profile may receive any strict subset of Delegation capabilities within its existing target and Authorization ceiling envelope.
- The Session Host may validate machine-checkable completion evidence but never converts that validation into automatic acceptance.
- Run completion, interruption, failure, or Session idleness never implies that a **Delegation Contract** was accepted.
- A normally completed child run that did not explicitly submit its **Delegation Contract** causes the Session Host to submit the final result for review with `host-captured` provenance.
- An interrupted or failed child run never produces an implicit submission; its **Delegation Contract** remains unresolved and is surfaced as needing attention.
- Read-only and write-capable assignments use the same submission and acceptance boundary; an authorized parent may review and accept a read-only result immediately.
- A **Derived child-management grant** gives the parent no authority over unrelated sessions and gives the child no reciprocal authority over its parent or siblings.
- Recursive descendant spawning has no separate product depth limit under the **Codex parity baseline**; every parent independently remains subject to its **Parent concurrency limit**, authorization, and Session Host resource admission.
- **Spawn profile inheritance** uses the parent's current model, thinking level, project, environment mode, tools, MCP, skills, sandbox, and approval mode when the spawn request supplies no authorized specialization.
- **Spawn profile inheritance** carries the parent run's **Authorization ceiling** into the derived child-management grant.
- Child-specific model, thinking, instructions, or agent-profile specialization may replace inherited defaults, while sandbox, approval, Authorization ceiling, filesystem, network, and credential settings may only stay equal or become more restrictive.
- **Spawn profile inheritance** applies only to a new child; messaging an existing session resolves that session's own **Target execution profile**.
- Internal **Launch profile seeding** copies the initiating Session's model, thinking level, tools, MCP, and skills when launch supplies no explicit values, while the new root's authorization resolves independently from the caller profile and **Authorization ceiling**.
- GUI launch uses the selected composer execution settings, while CLI launch resolves explicit flags before project and app-global defaults; neither path creates parent inheritance or a derived grant.
- Multi-agent tools are enabled by default, but an OpenWaggle-hosted agent launches or spawns another Session only after a direct user request or an applicable project or skill instruction authorizes delegation; requests for depth, research, or thoroughness alone do not authorize additional agent work.
- Matching Codex, users may disable model multi-agent capability globally or for a project; disabling it removes Session-launch and Session-spawn operations from the OpenWaggle-hosted agent's **Sessions tool** but does not disable GUI, CLI, or external MCP session discovery and management.
- OpenWaggle requires no named **Agent definition** for normal launch or spawn behavior and provides no mandatory implementer, explorer, reviewer, Queen, or Worker classes.
- The default launch or spawn behavior is represented by an absent **Agent role selection**, not by resolving a built-in or stored definition named `default`.
- Users may create project- and user-scoped **Agent definitions** with arbitrary stable names, and an authorized user or agent may select one independently for each launch or spawn.
- When no **Agent definition** is selected, the initiating agent describes the assignment through the **Delegation specification** and ordinary profile resolution supplies the execution defaults.
- **Agent definition discovery** is on demand and bounded; an explicitly supplied stable name resolves directly, while choosing among available specializations uses names, descriptions, and scopes without injecting every definition body into the Run.
- An **Agent definition** may narrow the exposed tools, skills, and MCP surface; select supported existing sandbox and approval modes; and supply model, reasoning, and Workspace defaults within the initiating caller's effective grants and **Authorization ceiling**.
- An **Agent definition** introduces no filesystem-path or network-domain policy language; those boundaries remain enforced by the selected existing runtime sandbox and approval mechanisms.
- Removing write-capable tools from an **Agent definition** is a tool restriction, not a read-only security guarantee; OpenWaggle describes an agent as read-only only when its effective runtime sandbox enforces that property.
- An **Agent definition** is not a Waggle preset: the former specializes one spawned agent, while the latter describes a one-shot collaborative workflow that may create several runs.
- Every custom **Agent definition** is authored as an **Agent definition document** with schema-versioned YAML frontmatter and a required non-empty Markdown body; JSON and TOML are not canonical authoring formats.
- Frontmatter contains machine configuration such as `name`, `description`, model, reasoning effort, tools, skills, MCP, an existing sandbox mode, an existing approval mode, and Workspace specialization, while the body supplies **Agent instructions**.
- **Agent instructions** and the per-invocation **Delegation specification** remain distinct prompt inputs: the former defines reusable agent behavior and the latter supplies the initial task and relevant handoff context.
- Runtime adapters map **Agent instructions** to the provider's appropriate agent-level system or developer instruction mechanism and never flatten them together with the Delegation task into one ambiguous prompt.
- An omitted Agent-definition `tools` field inherits the initiating caller's available tool surface, a non-empty list is an allowlist intersected with that surface, and an empty list exposes no tools.
- Agent definitions have no tool denylist; installing a new tool therefore cannot widen a definition that declares an explicit tool surface.
- Because Session Control uses one compact `sessions` tool, optional Agent-definition `sessionCapabilities` narrows its operations through the existing **Session capability grant**: omission inherits permitted operations, a list intersects them, and an empty list permits none.
- Agent-definition `sessionCapabilities` is never an authority source and cannot add a Session Control operation the initiating caller lacks.
- Agent-definition discovery observes valid file changes without requiring an OpenWaggle or Session Host restart.
- Accepting a launch or spawn atomically captures a **Resolved Agent snapshot**; every existing Session keeps its snapshot when the source definition is edited, renamed, deleted, shadowed, or made invalid.
- A **Resolved Agent snapshot** records the selected definition's stable name, source scope, schema version, source digest, instructions, and effective specialization so Session behavior remains explainable without keeping a live source-file dependency.
- A Session cannot rebind or re-resolve its own **Agent role selection** during a turn or between later turns; using a changed definition requires creating another Session.
- A later launch or spawn uses the latest valid resolved definition; an invalid current definition emits a visible diagnostic and blocks only new uses of that definition.
- The **Agent definitions settings surface** lists project- and user-scoped definitions with scope, validity, and source provenance and provides Create, Edit, Duplicate, Import, and Delete actions.
- Agent-definition editing renders schema-driven frontmatter controls plus a Markdown instruction editor, validates through the same application service as the CLI, and writes the canonical Markdown document rather than a parallel database representation.
- Agent definition documents are ordinary files like skill documents; agents may create or modify them through normal filesystem tools when the effective sandbox and approval mode authorize the target path.
- GUI and CLI Agent-definition mutations pass through normal filesystem authorization and introduce no separate Agent-management capability.
- A Session that edits a definition and later spawns from it still cannot widen authority: the new **Resolved Agent snapshot** is intersected with the spawning Session's effective grants and **Authorization ceiling**.
- Agent definitions never appear as a management hierarchy in the Session sidebar; an optional **Agent role selection** appears only where a user or agent launches or spawns a Session.
- The **Session identity header** keeps the Session title primary and shows compact secondary metadata for its Queen or Worker role and selected **Resolved Agent snapshot** name; a non-lineage root with a selected definition shows only the Agent name.
- The **Hive activity surface** repeats the current Session's compact role and selected Agent name beside its lineage navigation so the information remains visible at the point of spawning and steering Workers.
- Session-sidebar rows retain only the approved `ChessQueen` or `Pickaxe` lineage glyph; their tooltip may include the selected Agent name and, for a Worker, its immediate parent, without adding another badge or changing the flat hierarchy.
- Every Run receives an **Agent Session identity context** containing its stable Session identity; Queen, Worker, or independent-root classification; immediate parent identity and title when present; selected **Resolved Agent snapshot** name and scope when present; current Workspace identity, mode, and Working path; and the Session Control operations currently available to that Run.
- The Session Host, not the model or Agent-definition Markdown, authors the **Agent Session identity context** from current authoritative state at Run start.
- The **Agent Session identity context** includes no sibling or child list, related transcript, queue body, or Hive-wide summary; the agent retrieves authorized related state on demand through the compact `sessions` tool.
- A spawned Worker begins with fresh conversation context containing its **Agent instructions**, immutable **Delegation specification**, explicit handoff context and resource references, repository instructions and selected skills, and **Agent Session identity context**.
- Spawn never copies the Queen's transcript, hidden reasoning, Follow-up queue, or unrelated tool output into the Worker; shared Workspace files remain available through ordinary filesystem authorization.
- Any additional Session history requires an explicit authorized Session Control read; **Spawn lineage** alone gives a Worker no reciprocal transcript access to its parent or siblings.
- The frontmatter `name` is the stable Agent-definition identity; matching the filename is recommended for discoverability but the filename is not authority.
- Agent-definition YAML accepts only JSON-compatible data under a strict schema, rejects unknown fields, custom tags, aliases, includes, and environment interpolation, and applies explicit file and instruction size limits.
- The Markdown body is model instruction text rather than executable or trusted rendered HTML; links, code fences, and markup grant no capabilities.
- OpenWaggle publishes the **Agent definition schema** with the app, CLI, repository documentation, and user-facing website documentation, including field semantics, defaults, inheritance, reduction rules, examples, diagnostics, and migration notes for every schema version.
- An **Agent definition document** declares `schemaVersion` and may include the published `$schema` URL for editor completion; an unsupported version fails explicitly and is never interpreted as the current version.
- `openwaggle agents validate` performs syntax, schema, semantic, model/tool/MCP/skill resolution, permission-reduction, duplicate-name, and scope checks without starting a Session Host run.
- `openwaggle agents explain` reports the resolved definition, source and precedence, inherited/defaulted fields, effective reductions, and diagnostics without exposing credentials.
- `openwaggle agents import` uses a source-specific adapter for an explicitly named Codex, Claude, Cursor, Gemini CLI, GitHub Copilot, or OpenCode definition and produces an **Agent definition import plan** before any write.
- Import never passes foreign frontmatter directly to the OpenWaggle validator and never silently discards a field; every source field is classified as mapped, defaulted, dropped, incompatible, or requiring a user choice.
- Model, tool, MCP, and skill mappings resolve against Pi/OpenWaggle runtime catalogs rather than hard-coded vendor registries; unresolved or security-sensitive mappings block writing until explicitly resolved or explicitly accepted as a restrictive omission.
- The Settings import wizard and Sessions CLI use the same conversion and validation application service; machine mode supports schema-versioned dry-run output and explicit non-interactive mapping inputs.
- A converted document is written only after the complete target validates, using a temporary sibling and atomic installation, and existing destinations are never overwritten without explicit intent.
- Successful conversion creates an **Imported Agent snapshot**; OpenWaggle never watches, executes, or automatically synchronizes the foreign source directory.
- `openwaggle agents import --refresh` re-reads the recorded source explicitly, runs the current source adapter, and presents the complete conversion diff before validation and installation.
- Refresh compares the current canonical document with its recorded import baseline; local edits require an explicit conflict resolution and are never overwritten by source changes silently.
- Missing, moved, or changed-type source files leave the canonical snapshot usable and produce refresh diagnostics rather than deleting or disabling it.
- Canonical custom definitions are discovered from `.openwaggle/agents/*.md`, then `.agents/agents/*.md`, then `~/.openwaggle/agents/*.md`; foreign tool directories are never loaded implicitly.
- Duplicate definition names in one scope are errors, and an invalid higher-priority definition shadows lower definitions with a visible diagnostic rather than falling through silently.
- Agent-definition restrictions such as tool and `sessionCapabilities` allowlists and sandbox or approval ceilings are intersected with the caller and cannot be overridden by explicit launch or spawn values.
- Agent-definition preferences resolve from an explicit authorized launch or spawn value, then the selected definition's model, reasoning, or Workspace default, then the configured subagent default, then parent inheritance.
- OpenWaggle deliberately differs from Codex custom-agent model precedence by allowing an explicit per-operation model or reasoning preference to override the definition default while retaining every definition restriction.
- Other omitted **Agent definition** settings inherit from the parent through **Spawn profile inheritance**, and every declared reduction or override is revalidated against the parent's live grants before the child starts.
- The **Parent concurrency limit** defaults to four but may be configured by the user to a higher or lower positive value.
- The effective **Parent concurrency limit** resolves from project `.openwaggle/settings.json`, then app-global SQLite settings, then the product default, with the first defined value winning.
- Settings UI and CLI configuration commands update those existing OpenWaggle stores; OpenWaggle does not introduce Codex TOML as its configuration format.
- A **Session spawn** that would exceed the **Parent concurrency limit** fails with a structured capacity result and is never silently queued.
- The **Host run ceiling** defaults to sixteen active Pi runs and may be configured by the user to a higher or lower positive value in app-global SQLite settings.
- The **Host run ceiling** counts active root and descendant runs across every session owned by the Session Host; idle sessions, completed runs, waits, watches, indexing, and exports do not consume a run slot.
- A run-creating operation must satisfy both its parent-specific allowance and the remaining **Host run ceiling**; exhaustion returns structured retryable `host_capacity_reached` state and never creates a hidden run queue.
- The **Host run ceiling** is resource admission only: it introduces no Workspace lock, session-count limit, lineage-depth limit, or restriction on reading and organizing sessions.
- Settings and capacity responses show the effective parent allowance and remaining host slots so a raised **Parent concurrency limit** is not mistaken for immediately available host capacity.
- CI uses a deterministic controllable Pi provider to cover Session Host ownership, spawn lineage, shared and isolated Workspaces, steering, Follow-up delivery, waits, interruption, authorization, event resynchronization, exports, crashes, and all boundary adapters without network or paid-provider variability.
- The **Live orchestration smoke suite** is a release gate, not an ordinary CI job; it must spawn real child agents through an OpenWaggle-hosted parent and exercise GUI, Sessions CLI, and external MCP observation and control against the same Session Host.
- Release evidence records provider/model identity, packaged app version, platform, session and run identities, workspace selections, commands, expected and observed state transitions, and final outcomes without recording credentials or sensitive transcript content.
- A release cannot claim Session Control or Codex parity when the **Live orchestration smoke suite** is skipped or fails on the release candidate.
- A spawned child is a normal durable session that remains searchable, readable, exportable, and directly openable subject to authorization.
- An ordinary message sent while viewing a Worker stays in that Worker Session and does not reopen or revise its completed **Delegation Contract**.
- A **Cross-session report** is the explicit exception: `upstream` resolves to the immediate parent, `queen` resolves to the Hive root, and downstream delivery requires a named or stable Worker target; multi-target or descendant broadcast must be explicit.
- Report target resolution is deterministic: `upstream` and `queen` resolve from recorded **Spawn lineage**, a stable Session identity resolves directly, and a human-readable Worker reference resolves only when it uniquely identifies an authorized target.
- An absent or ambiguous report target returns a structured result with authorized candidate identities so the agent can clarify; OpenWaggle never guesses a target or expands ambiguity into a broadcast.
- A **Cross-session report** may request a reply; the Session Host assigns its stable report and correlation identities, and a reply is another authorized report that names the report it answers and retains the correlation identity.
- A caller may use **Session wait** with a bounded timeout to await a correlated reply, but neither the reply request nor the wait starts a Run in an idle target.
- Immediate consultation with an idle target requires a separate explicit Run-creating or messaging operation and its corresponding Session capability; reporting never hides that cost or authority boundary.
- A report request validates every target and required route before mutation, then succeeds only after the report and one per-target delivery record are durably committed together; a failed request creates no partial report.
- Each accepted target delivery is independently `pending` until the Session Host atomically appends its unique report context item to a target Run and marks it `delivered`; uniqueness by report and target makes recovery retries idempotent.
- Report status proves durable acceptance and model-context delivery only. It never claims that an agent read, understood, agreed with, or acted on the content, and a correlated reply remains a separate report fact.
- **Session wait** may await per-target report delivery or a correlated reply, and multi-target results preserve the status of every explicit target.
- The Session Host records each **Cross-session report** with source Session and Run identity, target identities, author provenance, and delivery state, then supplies it to an active target at its next safe agent-loop boundary or to an idle target on its next Run.
- The host presents report content in a provenance-labelled peer-agent context envelope below system, developer, and user instructions; Queen or Worker lineage never changes its instruction priority.
- A receiving agent evaluates a report under its own immutable Agent snapshot, current instructions, capabilities, and Authorization ceiling; report text cannot itself mutate authority, Agent definitions, Delegation Contracts, queues, Sessions, or Runs.
- Reporting is an agent capability, not a GUI interaction mode: the user requests it in ordinary conversation, the current agent invokes the explicit Sessions report operation, and OpenWaggle projects the tool activity and delivered context through its existing transcript surfaces.
- OpenWaggle adds no report-specific composer mode, slash command, target picker, overflow action, card, or unread workflow; CLI and MCP clients retain the structured report operation needed for machine interaction.
- A **Cross-session report** never starts, steers, interrupts, replaces, or reopens a Run and never creates, submits, accepts, reopens, or requests revision of a **Delegation Contract**.
- Spawn establishes only the narrow write-only lineage reporting routes required for a Worker to report to its immediate parent or Queen and for an authorized parent to report to its managed child; these routes grant no reciprocal Session read or management authority.
- Reports to any other sibling, descendant, unrelated Session, or multi-target set require `sessions:report` authorization for every explicit target; no natural-language mention silently broadens the route.
- The **Hive activity surface** projects **Spawn lineage** upward to the immediate parent and downward to direct Workers inside one collapsible block, groups Workers into Active and Done, keeps archived Workers under a collapsed `Archived · n` disclosure, and links to each Session instead of duplicating its transcript.
- The **Hive activity surface** classifies `working`, `waiting`, `needs_attention`, `ready_for_review`, and `revision_requested` **Delegation states** as Active, and classifies only `accepted` and `cancelled` as Done, independently of whether a Worker currently has an executing Run.
- Archiving an Active Worker changes only its organization: it remains in the Hive's active count, and the collapsed Archived disclosure reports its active and attention state without opening itself automatically.
- Completing a child does not archive or hide its durable session automatically.
- Child completion persists its full result in the child and produces an **Orchestration update** for the parent without creating a **Steering message** or **Follow-up message**.
- A parent **Run interruption**, replacement, completion, or session archival does not interrupt child runs automatically; child sessions and their active work remain independently controllable and durable.
- **Descendant interruption** is explicit and may target one child or all active descendants, matching Codex's separate individual-agent and stop-all controls.
- `interrupt-descendants` snapshots active recursive descendants deepest first, interrupts their exact Run identities, leaves the parent Run untouched, and reports each accepted Session/Run/state revision; native Pi uses the equivalent `interrupt_descendants` action.
- Every classic and Waggle Run persists a non-model **Run boundary** in Pi history. Projected nodes inherit the nearest ancestral Run identity, and `items --run <run-id>` retrieves that attributed slice through an indexed query without buffering the whole Session.
- **CLI client profile revocation** and **Session Host loss** remain security and recovery exceptions whose already-defined cascade rules take precedence.
- An active parent **Session wait** returns matching child results immediately; otherwise an active parent receives the **Orchestration update** at its next safe agent-loop boundary.
- An idle parent does not start a run for an **Orchestration update**; the **Hive activity surface** shows it and the next parent run receives any pending updates.
- Several child completions may be batched into one compact **Orchestration update** while their complete results remain readable from each child.
- A **Session wait** accepts one or more target identities, requested conditions, recent **Session event cursors**, and a bounded timeout, then returns compact current state and updated cursors for every target.
- A **Session wait** wakes when the first target reaches a requested condition and does not wake for every streaming event.
- The GUI consumes a **Session subscription**, while **Session watch** exposes the same authorized feed through the CLI.
- **Session discovery** searches title, initial objective, and current preview through **Session discovery text**, while **Transcript search** is an explicit broader operation.
- The default **Session discovery mode** is hybrid: exact lexical matches and semantic matches contribute candidates to one ranked result set.
- A lexical **Session discovery mode** remains available for exact and deterministic automation, while a semantic mode permits concept-only retrieval.
- Hybrid **Session discovery** falls back to lexical retrieval when its local semantic model or vector index is unavailable and reports that degradation to the caller.
- **Semantic discovery readiness** distinguishes model availability, projection progress, freshness, and failure so callers never interpret degraded hybrid results as complete semantic results.
- A semantic-only **Session discovery mode** never substitutes lexical results; when semantic retrieval is unavailable it returns **Semantic discovery readiness** and starts or identifies the relevant **Semantic discovery preparation**.
- A caller may wait for **Semantic discovery preparation** only with an explicit bounded timeout.
- Semantic **Session discovery** may match a query and **Session discovery text** written in different supported languages.
- Packaged semantic discovery uses the pinned Q8 `Xenova/multilingual-e5-small` revision offline, verifies every bundled file by SHA-256, and never downloads a model at runtime.
- Lexical **Session discovery** reflects committed discovery-text changes immediately, while a **Semantic discovery snapshot** is published asynchronously after completed-message boundaries.
- **Semantic discovery preparation** wakes on committed source changes, retains a recovery poll, publishes readiness through **Session watch**, and carries one stable preparation-operation identity through ready or failed publication.
- Hybrid **Session discovery** combines current lexical results with the latest **Semantic discovery snapshot** and reports its coverage, pending count, and freshness.
- A semantic caller may require a fresh **Semantic discovery snapshot** only with an explicit bounded wait.
- Every **Session discovery** result carries **Session discovery evidence** without exposing model-specific ranking values as a stable API contract.
- Raw lexical, vector-distance, and fusion scores are available only through explicit diagnostics.
- **Session discovery** evaluates the complete authorized corpus but returns pages from a bounded **Session discovery window**.
- Exact semantic candidate search remains the default while the reproducible 50,000-session benchmark stays within the accepted latency budget; approximate search requires measured evidence at the supported-machine or observed-corpus crossover.
- Exhaustive traversal belongs to session listing and indexed metadata filtering, not hybrid or semantic discovery.
- The first discovery page fixes one short-lived **Session discovery window**, and its **Session discovery cursor** preserves that ranking while the underlying session corpus changes.
- A **Session discovery cursor** is bound to its caller, query, authorization scope, and lexical and semantic index revisions; it cannot be transferred to another caller.
- Authorization is re-evaluated for every discovery page, and an expired or host-lost **Session discovery cursor** fails explicitly instead of silently starting a different traversal.
- A **Session read** never resumes, loads into the agent runtime, or subscribes to its target and never returns unbounded history in one response.
- Complete authorized history remains readable through cursor-paginated **Transcript read snapshots**; CLI whole-history output streams those pages without accumulating the transcript in memory.
- The existing code concept `SessionWorkspace` is renamed to **Session conversation view**, including its shared type, repository method, IPC contract, renderer state, and tests, before filesystem **Workspace resource** APIs are introduced.
- “Workspace” is reserved for an execution working tree and its bindings; conversation-tree selection and transcript projection never use that term in public or internal APIs.
- A **Transcript read snapshot** defaults to the active branch fixed when the read begins, while a caller may select another branch explicitly.
- Whole-tree transcript reading is explicit and emits each shared node once with its parent and branch identities instead of duplicating common branch history.
- One **Run start** creates one **Transcript turn**, and every **Transcript item** produced before that run's terminal outcome belongs to that turn.
- A **Steering message** adds items to its existing **Transcript turn**, while delivery of a **Follow-up message** starts a new run and therefore a new turn.
- Legacy transcript items whose exact historical run boundary cannot be recovered use explicitly synthetic turn identities.
- **Transcript turn** pages default to newest-first traversal, while callers may request oldest-first traversal for replay or complete reading.
- **Transcript items** within one turn are always ordered chronologically, and a bounded recent-turn slice is returned chronologically after selection from the newest end.
- A none **Transcript item view** returns turn structure and counts, summary returns bounded previews and activity metadata, and full returns complete durable item content within page limits.
- Oversized attachment bodies and binary data remain referenced in every **Transcript item view** until explicitly read through their authorized resource operation.
- **Transcript search** may locate relevant turns before a caller reads surrounding pages or traverses the complete **Transcript read snapshot**.
- The default **Transcript search scope** includes visible user and assistant text, orchestration updates, tool names and outcomes, and attachment filenames.
- Tool arguments and results, extracted attachment bodies, and visible reasoning enter a **Transcript search scope** only when explicitly requested and authorized.
- Hidden reasoning and inaccessible resource content never enter a **Transcript search scope**.
- Lexical **Transcript search** is incrementally available by default, while semantic or hybrid transcript retrieval requires an explicit **Semantic transcript projection** for one session or a bounded session set.
- **Semantic transcript projection** preparation uses observable readiness, progress, failure, and explicit bounded waiting without blocking lexical transcript search.
- The **Semantic transcript storage policy** caps the rebuildable cache at 5,000 recent searchable nodes per Session, 50,000 node records, 64 MiB of vectors, and 10,000 queued nodes; inactive scopes expire after seven days.
- Active semantic prepare, bounded wait, and search operations hold durable expiring leases, so least-recently-used cleanup never evicts their scope and host loss cannot leave a permanent lease.
- A scope outside the **Semantic transcript storage policy** reports terminal `partial` readiness with searchable, eligible, and prepared counts. `requireFresh` waits only for admitted work, hybrid retrieval degrades explicitly to complete lexical search, and complete Transcript reads remain unaffected.
- Every semantic transcript match identifies the exact turn and item range from which bounded context can be read.
- Canonical **Session export** is lossless schema-versioned JSONL streamed from the authorized read snapshot rather than copied from Pi's runtime session file.
- Markdown **Session export** is a human-readable derived rendering and does not promise lossless round-tripping.
- A **Session export bundle** adds a manifest and only those authorized resources the caller explicitly requests, recording integrity metadata for each included artifact.
- A **Session export** may snapshot an active session without interrupting it, includes only durable items through a fixed high-water mark, and identifies an incomplete active turn explicitly.
- A caller may request bounded waiting for an idle export snapshot, but export never waits indefinitely or includes uncommitted streaming tokens.
- A **Session export** includes Follow-up queue state, revision, counts, and item identities by default but excludes pending message bodies.
- Queued message bodies enter a **Session export** only through explicit inclusion with `sessions:queue` and `sessions:read`, and the export manifest records whether they were included or omitted.
- Canonical JSONL **Session export** preserves every selected authorized record unless the caller explicitly selects an **Export redaction profile**.
- An **Export redaction profile** records each omission or replacement and never makes inaccessible content readable.
- **Session export** defaults to the active branch captured in its read snapshot, while one other branch or the whole session tree requires explicit scope selection.
- Whole-tree **Session export** emits shared nodes once with parent and branch membership, and every export manifest declares its branch scope.
- A file or bundle **Session export** refuses to replace an existing destination unless overwrite intent is explicit.
- A file or bundle **Session export** becomes visible at its final destination only after its temporary artifact is complete, validated, and atomically installed.
- A destination **Session export** runs as a **Session export operation** with identity, progress, status, bounded wait or watch, and cancellation, and continues if its initiating client disconnects.
- A stdout **Session export** remains a foreground stream owned by its client connection and is not a durable **Session export operation**.
- Each session has at most one semantic representation of its **Session discovery text**; default discovery never embeds every transcript message.
- **Session discovery** returns bounded cursor-paginated summaries and never loads, resumes, or subscribes to a matching session.
- Session-list and **Session discovery** cursors remain deterministic when sessions share the same update time or search rank.
- Matching Codex, the **Sessions CLI** defaults list, search, and interactive selection to **Session catalog scope** `working-path`; `--project` includes every Workspace in the resolved repository project, and `--all` selects the complete authorized catalog.
- An explicit stable Session identity addresses that Session directly regardless of the caller's default **Session catalog scope**, while normal authorization and discoverability checks still apply.
- The internal **Sessions tool** requires an explicit **Session catalog scope** for discovery beyond the current session's Working path, preventing model-generated searches from broadening silently while still permitting authorized all-session retrieval.
- The **Local Session transport** uses an authenticated Unix-domain socket or Windows named pipe with request-response commands, subscriptions, version negotiation, canonical snapshots, and bounded **Session event cursors**.
- The Electron main process projects **Session Host** events to renderer IPC so CLI and agent actions update every open window live.
- A Session snapshot includes a state revision and **Session event cursor**; subscribing after that cursor replays any events still in the bounded host window before continuing with live ordered events.
- A cursor from another host instance, an expired cursor, or a slow consumer whose bounded delivery buffer overflows receives structured `resync_required` and performs **Session resynchronization**.
- Durable Session state, transcript items, and completed-operation records are authoritative; event notifications and their replay window are transient projections and are not an export or audit log.
- Client event consumption never applies backpressure to an agent run, Follow-up delivery, or another client; a lagging client is disconnected and resynchronizes instead.
- A **Blocking agent-loop interaction** announces itself politely and is reachable without the user losing their place in the composer, and the shortcut that reaches it belongs to the **Shortcut registry**.
- No **Authorization decision** is bound to a single keystroke, because a mistyped key must not be able to grant a capability.
- An extension renders its own contributions freely in the **Transcript agent-loop surface** and owns a **Custom desktop interaction** end to end.
- An **Authorization request** and the standard user-input requests are presented by OpenWaggle's own prompt, which an extension cannot replace, although it may still contribute a dialog, a transcript card, or a status widget alongside that prompt.
- A status widget belongs to the run rather than to any single pending interaction.
- An **Authorization request** is distinct from informational notifications and user-input requests because it can produce a reusable scoped grant.
- An **Authorization request** identifies its action, requester, exact target, and effect in user-facing language.
- A session **Authorization mode** overrides its project's mode, which overrides the global default.
- A session or project without an **Authorization mode override** inherits the next level's default, and clearing an override restores that inheritance.
- Before a session exists, the composer may hold a **Draft authorization override**. First send creates the session, persists that explicit choice as its **Authorization mode override**, and only then launches the task.
- A draft without a **Draft authorization override** continues to inherit the project or global default; first send does not copy that effective default into the session.
- The **Effective authorization mode** is resolved when an **Authorization request** occurs rather than when the session is created, so changing a project or global default applies to existing sessions that hold no override.
- The **Effective authorization mode** is the less permissive of the live global/project/session mode chain and the active run's **Authorization ceiling**.
- The zero-setup **Local-user identity** follows the user's normal Authorization settings, while a named external **CLI client profile** defaults to an **Ask for Approval** Authorization ceiling so an inherited global or project **YOLO (Full Access)** preference cannot elevate that restricted profile implicitly.
- A **Run authorization override** takes precedence over the global/project/session mode chain for that run but remains clamped by its **Authorization ceiling**.
- A CLI `--yolo` option is shorthand for a YOLO **Run authorization override**, not for changing a persistent **Authorization mode override**.
- Reducing the scoped **Authorization ceiling** of an active run takes effect at its next authorization boundary and on every later descendant spawn; it does not terminate an already executing tool call or undo a completed action.
- An unresolved **Authorization request** is re-evaluated against a reduced ceiling, and every subsequent protected action uses the newly constrained **Effective authorization mode**.
- **YOLO (Full Access)** resolves **Authorization requests** automatically but leaves unrelated user-input requests pending for the user.
- A **Request purpose** is declared where the request is raised, never inferred from its wording.
- A request whose **Request purpose** is disclosure or external navigation is never answered automatically in any **Authorization mode**, because its consequence is the user's to accept.
- **YOLO (Full Access)** is the global default **Authorization mode** for new projects and sessions without an override.
- **Ask for Approval** presents only **Authorization requests** that are not already covered by a **Scoped authorization grant**.
- A **Scoped authorization grant** applies only when its project, requester, capability, and resource or destination all match.
- An **Authorization request** produces exactly one **Authorization decision**.
- A surfaced **Authorization request** has exactly one **Authorization history entry**, which changes from pending to the final **Authorization decision** instead of creating separate request and resolution cards.
- Changing a session to **YOLO (Full Access)** resolves its pending **Authorization request** automatically; changing to **Ask for Approval** governs subsequent requests without revoking completed authorization decisions.
- **YOLO (Full Access)** does not create authorization prompts, authorization transcript entries, approval counters, or a separate authorization log; authorized work remains visible through its normal activity or result presentation.
- The composer trigger presents the effective **Authorization mode** compactly as `YOLO` or `Ask for approval`; its open menu exposes exactly the canonical **YOLO (Full Access)** and **Ask for Approval** choices. Inheritance stays internal, and the menu checks the effective choice without adding a user-facing default option.
- An active **Agent notification** is presented in a **Notification stack** clear of the composer, never as an authorization prompt or transcript card.
- A **Notification stack** fronts the most severe active notice and stacks additional notices behind it.
- The composer area is reserved for requests that hold the run, so the surface a user acts on is always the one nearest the prompt input.
- An informational or warning **Agent notification** leaves the **Notification stack** on its own; an error one stays until the user dismisses it.
- Time towards leaving the **Notification stack** accrues only while the application window is focused, so a notice cannot expire unwatched.
- An informational **Agent notification** is ephemeral and does not create transcript history.
- A warning or error **Agent notification** creates exactly one **Durable notification notice**.
- An **Extension contribution surface** is rendered inside an **Extension contribution container**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension contribution runtime**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension execution placement**.
- A **Federated module runtime** receives an **Extension SDK surface** instead of importing OpenWaggle internals.
- A **Federated module runtime** may use **OpenWaggle shared extension modules**, but the required contract is the **Extension mount context**.
- A **Federated module runtime** starts by calling the extension module with an **Extension mount context**.
- An **OpenWaggle shared extension module** may be distributed through an **OpenWaggle publishable package**.
- The **Extension SDK package** is the **OpenWaggle publishable package** for the **Extension SDK surface**.
- The **Extension SDK package** must not expose OpenWaggle renderer components, Electron IPC internals, writable stores, main-process services, Pi SDK package types, or development fixtures.
- The **Extension SDK package** is browser-safe and must not import Electron, Node built-ins, main-process services, renderer stores, or Pi SDK packages.
- The **Extension SDK package** owns the **Canonical package source** for author-facing extension SDK APIs, and OpenWaggle app code should consume that package source through the workspace.
- The **Extension SDK package** exports **Public boundary schemas** alongside TypeScript types for public manifests, contributions, broker payloads, docs discovery, and agent-loop interactions.
- The **Extension SDK package** exposes helper APIs around **Public boundary schemas** for common author workflows such as defining and validating extension manifests.
- A **Public boundary schema** must not expose internal lifecycle stores, application services, or renderer implementation state.
- Exporting **Public boundary schemas** makes `effect` a **Package runtime dependency** of the Extension SDK package.
- Effect Schema is the primary **Public boundary schema** format for the first Extension SDK package release; generated JSON Schema may be added later as a secondary artifact.
- The **Extension SDK package** stays free of React.
- The **Extension React package** depends on the **Extension SDK package** and carries React plus React DOM as explicit peer dependencies.
- `react` and `react-dom` at `^19.0.0` are the initial **Package peer dependency** ranges for the Extension React package.
- The first Extension React package release includes Extension React primitives for buttons, inputs, textareas, checkboxes, selects, badges, panels, stacks, fields, and alerts.
- Extension React primitives use the **Extension UI style contract** instead of importing OpenWaggle app CSS.
- The first public publishing scope includes the Extension SDK package, Extension React package, Waggle core package, and Pi Waggle package.
- The **Pi Waggle package** depends on the **Waggle core package** so Pi users can install one package for Waggle mode.
- The **Pi Waggle package** declares explicit Pi package **Package peer dependency** ranges instead of wildcard peers.
- The **Pi Waggle package** may re-export commonly used stable **Waggle core package** types and helpers, but it is not a full mirror of every core API.
- The **Waggle core package** can be used without the **Pi Waggle package** when another tool wants Waggle mode without Pi-specific integration.
- The **Waggle core package** is runtime-neutral and must not import Pi SDK packages, Electron, Node built-ins, OpenWaggle renderer stores, or app services.
- An **OpenWaggle publishable package** is distinct from the OpenWaggle desktop app artifact and from a **Development extension fixture**.
- A **Pinned session** is one session; it appears in the **Pinned section** and not in its project group, so no session is listed twice.
- A **Pinned session** keeps its pin when archived; the row leaves the **Pinned section** while archived and returns on unarchive.
- The **Pinned section** is ordered by exactly one **Pinned sort**; only **Manual order** is user-authored, and the derived sorts never overwrite it.
- A **Pinned shortcut** belongs to a **position** in the **Pinned section**, never to a particular **Pinned session**.
- Projects are not pinnable: quick access is expressed only through **Pinned sessions**.
- Multiple **OpenWaggle publishable packages** can share one **Package publishing workflow** while remaining separate packages.
- An **OpenWaggle publishable package** has an **Independent package version** even when it uses the shared **Package publishing workflow**.
- The **Release Please package workflow** is the selected **Package publishing workflow** for OpenWaggle publishable packages.
- The **Release Please package workflow** is separate from the **App release workflow** even though both live in the same repository.
- An **OpenWaggle publishable package** ships **Dual package output**.
- **Dual package output** is produced by a **Plain TypeScript package build** unless a future package has a documented reason to bundle.
- An **OpenWaggle publishable package** exposes public imports only through its **Package export boundary**.
- Changing a **Package export boundary** is a public package contract change.
- An **OpenWaggle publishable package** declares **Package side-effect metadata** explicitly.
- An **OpenWaggle publishable package** declares **Package publish access** as `public`.
- **Package tarball contents** include built outputs and package docs, not TypeScript source files, tests, fixtures, local scripts, configs, or caches.
- **Package import boundary checks** enforce browser-safe, runtime-neutral, and adapter-layer package boundaries during `pnpm check`.
- The **Release Please package workflow** requires **Package publish validation**, not full desktop app release validation, unless app code changed.
- A **Package release commit** affects only the OpenWaggle publishable package paths it touches directly.
- The **Package release PR** is the explicit human gate before automated package publication.
- The **Release Please package workflow** uses **Trusted package publish** after the Package release PR is merged.
- A **Trusted package publish** runs only from a **Package publish event**; recovery dispatch must name one exact Package release tag.
- A **Package namespace bootstrap** creates setup-only placeholders and is not a real package release or a local release fallback.
- **Package publish validation** includes a **Package provenance gate** before package publication.
- **Package publish validation** includes **Package manager smoke tests** for npm, pnpm, Yarn, and Bun where practical.
- **Package publish validation** includes **Package API snapshots** for public package exports.
- **Package API snapshot checks** should use API Extractor-style declaration reports if practical, otherwise a deterministic repository-owned declaration snapshot script.
- An **OpenWaggle publishable package** has its own **Package changelog** and **Package release tag**.
- An **OpenWaggle publishable package** has its own **Package GitHub release**.
- An **OpenWaggle publishable package** has a **Package README** and a comprehensive **Package documentation page** on openwaggle.ai.
- **Package API snapshots** are internal validation artifacts and are not explained in user-facing **Package documentation pages** or **Package READMEs**.
- Package documentation pages live in the **Packages documentation section**.
- The initial **Packages documentation section** contains overview, Extension SDK, Extension React, Waggle core, and Pi Waggle pages.
- An **OpenWaggle publishable package** may require a **Dependent package bump** when one of its OpenWaggle package dependencies changes.
- A **Published package dependency range** uses a caret semver range for the released dependency version.
- The **Pi Waggle package** receives a **Dependent package bump** whenever the **Waggle core package** changes.
- The **Extension React package** receives a **Dependent package bump** whenever the **Extension SDK package** changes.
- Each **OpenWaggle publishable package** uses semver for its public contract.
- The initial **Package engine baseline** is Node.js `>=22.19.0` for every OpenWaggle publishable package.
- The **Initial public package version** for the Extension SDK package, Extension React package, Waggle core package, and Pi Waggle package is `0.1.0`.
- The first public package release requires the `@openwaggle` **Package namespace** to be owned and configured; OpenWaggle publishable packages do not use a temporary scope.
- The **Extension capability broker** authorizes calls made through the **Extension SDK surface**.
- **Extension author documentation** is the source of truth for the public **Extension SDK surface**.
- **Agent-facing installed documentation** is derived from user-facing OpenWaggle documentation at build or packaging time and exposed through a Pi-style package-local `docs/` directory.
- **Agent-facing installed documentation** includes the full OpenWaggle documentation set and installed Pi documentation so self-modifying agents can inspect product and runtime contracts locally.
- **Agent-facing installed documentation** starts at an **Installed docs index** with stable paths and topic aliases.
- A **Docs discovery capability** returns local paths, titles, anchors, keywords, aliases, and source metadata inside **Agent-facing installed documentation** for known documentation topics.
- A **Docs discovery capability** resolves closed first-party **Docs discovery topics** instead of arbitrary strings.
- A **Docs discovery capability** exposes discovered **Extension package documentation** through a structured extension namespace without allowing extensions to override first-party **Docs discovery topics**.
- **Extension package documentation** is discoverable regardless of trust or enablement, with trust, lifecycle, scope, package path, and content hash reported as provenance metadata.
- A **Docs discovery capability** is available to extension code through the **Extension SDK surface** and to OpenWaggle's **Self-modifying agent context**.
- An **OpenWaggle state read capability** exposes selected OpenWaggle state through the **Extension SDK surface**.
- An **OpenWaggle action capability** exposes selected OpenWaggle behavior changes through the **Extension SDK surface**.
- **Extension package state** can be shared by multiple **OpenWaggle desktop contributions** from the same package.
- Persistent extension data is written through typed storage capabilities, not by making **Extension package state** persistent by default.
- **Extension contribution instance state** belongs to exactly one mounted contribution instance.
- **Agent-loop durable state** is the source of truth for rendering historical **Agent-loop contributions**.
- **Pending interaction state** belongs to OpenWaggle while Pi is waiting for user feedback.
- **Extension package state** and **Extension contribution instance state** may enhance live rendering, but they are not **Agent-loop durable state**.
- OpenWaggle owns each **Extension contribution container**; the extension owns only the content mounted inside it.
- The **Composer extension surface** is constrained to compact actions and launchers instead of arbitrary composer input injection.
- The **Composer add menu** opens the existing attachment chooser, **File mention menu**, or filtered **Slash command menu**; it does not define parallel draft nodes, payload metadata, or persistence.
- `Reference project file` in the **Composer add menu** is equivalent to opening the `@` **File mention menu**, while `Use a skill` and `Start Waggle` are filtered views of the `/` **Slash command menu**.
- The **Composer extension surface** remains separate from the **Composer add menu** so pending extension interactions and extension-owned launchers are not hidden inside prompt insertion actions.
- The **Design token contract** has exactly one definition, published by the extension SDK; the app consumes it rather than maintaining a parallel token set, so extension UI cannot visually drift from host UI.
- An **Appearance** supplies a value for every **Semantic role** in the **Design token contract** and carries one **Colour scheme**.
- The **Design token contract** adopts Tailwind's standard scales as its vocabulary and exposes them as themeable variables: utilities are the only consumption path and variables are the only override path, so deviation is structurally impossible.
- A **Derived token** is computed from **Semantic roles**, so it re-themes with an **Appearance** without appearing in the public contract.
- Every session has exactly one active **Workspace binding**, while one **Workspace resource** may have multiple session members.
- A project's primary checkout is represented by one local **Workspace resource**; each OpenWaggle-managed git worktree is represented by its own worktree-backed Workspace resource.
- A session's git reads and writes target its bound Workspace's **Working path**; **Session environment mode** reports whether that Workspace is local or worktree-backed. Repository-level data remains project-keyed because linked worktrees share refs.
- Under the **Codex parity baseline**, a **Session spawn** defaults to **Spawn workspace selection** `share-parent`, preserving the exact parent Working path and uncommitted state; `new-worktree` explicitly creates a distinct Workspace resource, and `local` explicitly binds the child to the primary checkout Workspace.
- **Session launch** defaults **Launch workspace selection** to `current`: an internal agent resolves its initiating Session's exact Workspace, the CLI resolves its current Working path, and the GUI resolves its selected Workspace or project context.
- An authorized launch may explicitly select `new-worktree`, `local`, or a specific existing Workspace resource; choosing an independent root changes lineage and authority, not filesystem placement by itself.
- A shared **Workspace resource** adds no workspace-specific run limit or writer lock beyond the configured parent and host capacity controls; parent and child runs may operate concurrently as Codex subagents do.
- A **Turn diff** captured during overlapping runs in one Workspace is marked as shared-concurrent Workspace observation rather than exclusive authorship, while isolated Workspaces retain ordinary attribution semantics.
- A managed **Session worktree** remains alive while any **Workspace binding** references it; archiving or moving one member releases only that binding, and cleanup becomes eligible only after the final binding is removed.
- Worktree path and temporary branch identity derive from the **Workspace resource** identity, so membership changes never rename, recreate, or strand the checkout.
- A **Work-locally fallback** preserves the session and submitted user turn, records `local` **Session environment mode**, and starts that turn in the opened checkout without duplicating it.
- Cancelling first-send worktree creation removes the optimistic transcript turn and restores the exact pre-send composer draft, including its attachments and skill or Waggle invocation.
- **Worktree launch progress** advances through `Preparing workspace`, `Checking out files`, `Worktree created`, and `Starting a task`; completed, active, and pending stages use the corresponding semantic design-token roles.
- **Worktree launch progress** includes only stages that correspond to real operations. A percentage is shown only when the underlying operation reports measurable progress, and `More details` exposes real operation output and diagnostics rather than fabricated activity.
- When worktree creation completes, **Worktree launch progress** collapses its bordered steps to `Worktree created` while `Starting a task` remains active. When Pi agent activity begins, the active setup component becomes a durable **Worktree launch trace** rather than disappearing.
- A **Worktree launch trace** is app-owned transcript activity, not an assistant message or **Agent phase**. It remains after reload and exposes the real retained setup output through a compact disclosure.
- Optional setup activity produces an additional durable trace only when OpenWaggle actually performed that setup; absent operations leave no synthetic history.
- A launch that uses **Work-locally fallback** or is cancelled leaves no `Worktree created` trace, because no successful worktree creation occurred.
- A **Failed worktree launch** keeps the submitted user message visible and presents `Retry`, `Work locally`, `Cancel`, and `More details`. Retry and Work locally continue the retained turn exactly once; Cancel removes it and restores its exact pre-send draft.
- A **Failed worktree launch** does not also restore the retained message into the composer, because representing the same intent as both a transcript turn and a draft invites a duplicate send.
- The **Session context row** states which project, environment, and ref the next send uses: its **Project picker** chooses the project, its environment control owns the **Session environment mode**, and its **Run target picker** owns the **Run target**, which resolves to the checked-out branch or the **Worktree base ref** depending on the mode. It is distinct from the **Branch-diff base ref** chosen in the diff panel.
- Before first send, **Session environment mode** and **Run target** are separate editable controls. Submitting freezes the launch plan and collapses the setup row out of the composer. A worktree launch leaves its compact trace in the transcript instead of keeping a second toolbar beside every later prompt.
- The frozen **Worktree base ref** remains birth provenance. If Git changes the checked-out branch later, the read-only branch value follows the working tree without rewriting that provenance or turning the composer into branch administration.
- **Work-locally fallback** is the only environment change offered during worktree birth because it atomically redirects the retained launch; it is not an unlocked **Session environment mode** control.
- The **Run target picker** only searches and selects existing refs; branch creation, copy-name, origin policy, change-request checkout, and branch administration live outside that focused choice (ADR 0017).
- The **Changed-file navigator** lists files within the active diff scope, so its contents change with **Working-tree diff**, **Branch diff**, or **Turn diff** selection.
- The **Diff chrome** is a set of **Derived tokens**, so it always matches the active **Appearance**; the **Syntax theme** is independent and selectable on its own.
- A **Review comment** anchors to a diff line and carries its **Hunk** snippet; a **Review** gathers pending Review comments plus an optional **Review summary** and submits them to the agent as one message, never touching the composer.
- A **Review** targets the agent, whereas a **Change request** targets a remote (GitHub/GitLab); they share no state.

## Example dialogue

> **Dev:** "Should this extension add a route or a side panel?"
> **Domain expert:** "That is the **Extension contribution surface** decision; both can still use the same **Federated module runtime**."

> **Dev:** "Can we ship the GitHub Issues Overview fixture as a built-in extension?"
> **Domain expert:** "No — it is a **Development extension fixture**. Installed apps should expose **Extension authoring roots** for users and agents to create their own packages."

> **Dev:** "Should this extension register its own OpenWaggle tool loop?"
> **Domain expert:** "No — it registers Pi-native tools and can add **Agent-loop contributions** so OpenWaggle renders progress, results, approvals, or feedback in desktop surfaces."

> **Dev:** "Should this transcript card bind to the extension contribution id?"
> **Domain expert:** "No — the **Agent-loop binding identity** is the Pi tool name or custom message type; the contribution id only identifies the OpenWaggle renderer entry."

> **Dev:** "Can the same Pi tool show a card in the transcript and details in a side panel?"
> **Domain expert:** "Yes — those are separate **Agent-loop contributions** sharing one **Agent-loop binding identity**, with the **Transcript agent-loop surface** preserving the durable record."

> **Dev:** "Can I import OpenWaggle renderer components from the extension SDK package?"
> **Domain expert:** "No — the **Extension SDK package** exposes author contracts and helpers, not app internals or renderer components."

> **Dev:** "Can the Extension SDK package import Electron, Node built-ins, renderer stores, or Pi packages?"
> **Domain expert:** "No — the **Extension SDK package** is browser-safe and communicates through the brokered **Extension SDK surface**."

> **Dev:** "Where do React UI primitives for extensions live?"
> **Domain expert:** "In the optional **Extension React package**, not in the core **Extension SDK package**."

> **Dev:** "Is Extension React the full OpenWaggle design system?"
> **Domain expert:** "No — it starts with **Extension React primitives** for common extension forms and surfaces."

> **Dev:** "Should Extension React import OpenWaggle Tailwind or renderer CSS?"
> **Domain expert:** "No — Extension React primitives use the **Extension UI style contract**."

> **Dev:** "Should the app keep its own copy of extension SDK helpers under shared source?"
> **Domain expert:** "No — the **Extension SDK package** is the **Canonical package source**, and the app consumes it through the workspace."

> **Dev:** "Should extension authors get runtime schemas or only TypeScript types?"
> **Domain expert:** "They should get **Public boundary schemas** for values they send to or receive from OpenWaggle."

> **Dev:** "Should the Extension SDK hide Effect Schema behind helpers?"
> **Domain expert:** "No — expose **Public boundary schemas** directly and also provide helper APIs for the common path."

> **Dev:** "Is `effect` only an app dependency?"
> **Domain expert:** "No — exported **Public boundary schemas** make it a **Package runtime dependency** for the Extension SDK package."

> **Dev:** "Should the Extension SDK replace Effect Schema exports with JSON Schema for `0.1.0`?"
> **Domain expert:** "No — Effect Schema remains the primary **Public boundary schema** format; JSON Schema can be generated later as a secondary artifact."

> **Dev:** "If I use Pi, should I install both Waggle packages?"
> **Domain expert:** "No — install the **Pi Waggle package**; it includes the **Waggle core package** as its policy dependency."

> **Dev:** "Can the Pi Waggle package use wildcard Pi peer dependencies?"
> **Domain expert:** "No — the **Pi Waggle package** declares explicit Pi package **Package peer dependency** ranges for the Pi API line it was built against."

> **Dev:** "Should Pi users import every core helper through the Pi package?"
> **Domain expert:** "No — the **Pi Waggle package** can re-export common stable core types, but advanced core APIs should come from the **Waggle core package**."

> **Dev:** "Can another runtime use Waggle mode without Pi?"
> **Domain expert:** "Yes — use the **Waggle core package** without the **Pi Waggle package**."

> **Dev:** "Can Waggle core import Pi, Electron, Node built-ins, renderer stores, or app services?"
> **Domain expert:** "No — the **Waggle core package** is runtime-neutral reusable policy; Pi integration belongs in the **Pi Waggle package**."

> **Dev:** "Can a renderer approve a tool call by mutating Pi state directly?"
> **Domain expert:** "No — an **Interactive agent-loop contribution** returns a typed response to the pending Pi interaction through the **Extension capability broker**."

> **Dev:** "Can an extension invent a modal payload that only OpenWaggle understands?"
> **Domain expert:** "Not for common cases — it should use a **Pi interaction primitive** with an **Extension interaction schema**, and only use typed custom when the primitive set is not enough."

> **Dev:** "Should OpenWaggle run a Pi TUI custom component inside Electron?"
> **Domain expert:** "No — it should render a **Custom desktop interaction** and return the typed result to Pi."

> **Dev:** "What happens if the extension renderer for a confirmation fails?"
> **Domain expert:** "The **Agent-loop fallback renderer** handles the standard **Pi interaction primitive** so the tool does not hang."

> **Dev:** "Should every user prompt render in the same place?"
> **Domain expert:** "No — a **Blocking agent-loop interaction** should be prominent, while the **Transcript agent-loop surface** keeps the audit trail."

> **Dev:** "Can the historical transcript depend on the side panel still being mounted?"
> **Domain expert:** "No — **Agent-loop durable state** reconstructs history; live extension state only enhances active surfaces."

> **Dev:** "Can an extension renderer import Pi SDK types directly?"
> **Domain expert:** "No — it consumes **Agent-loop event DTOs** that preserve Pi semantics through public OpenWaggle schemas."

> **Dev:** "Should `@openwaggle/extension-sdk`, `@openwaggle/waggle-core`, and `@openwaggle/pi-waggle` be one package?"
> **Domain expert:** "No — they are separate **OpenWaggle publishable packages**, but they should use the same **Package publishing workflow**."

> **Dev:** "Should package publishing use Changesets?"
> **Domain expert:** "No — use the **Release Please package workflow** to match the existing ts-match publishing model."

> **Dev:** "Should npm package versions follow the desktop app version?"
> **Domain expert:** "No — **OpenWaggle publishable packages** use the **Release Please package workflow**, while desktop artifacts use the separate **App release workflow**."

> **Dev:** "Can a publishable package export raw TypeScript source?"
> **Domain expert:** "No — an **OpenWaggle publishable package** ships **Dual package output** with built JavaScript and TypeScript declarations."

> **Dev:** "Should package builds use tsup, Rollup, or Vite library mode?"
> **Domain expert:** "No — use a **Plain TypeScript package build** like `ts-match` unless a specific package has a documented bundling need."

> **Dev:** "Can consumers deep-import files from `src/`, `dist/`, or `dist-cjs/`?"
> **Domain expert:** "No — consumers use only the **Package export boundary** documented in `package.json` exports."

> **Dev:** "Can package side effects be left implicit?"
> **Domain expert:** "No — each package declares **Package side-effect metadata**; only the Extension React stylesheet is side-effectful."

> **Dev:** "Can scoped package public access be left to npm defaults?"
> **Domain expert:** "No — each package declares **Package publish access** with `publishConfig.access: public`."

> **Dev:** "Can package tarballs include `src/**/*.ts`?"
> **Domain expert:** "No — **Package tarball contents** include built outputs and package docs, not source files or local development artifacts."

> **Dev:** "Are package import boundaries enforced only by code review?"
> **Domain expert:** "No — **Package import boundary checks** fail `pnpm check` when a publishable package imports forbidden host/runtime internals."

> **Dev:** "Can packed package manifests keep `workspace:*` dependencies?"
> **Domain expert:** "No — packed manifests use a **Published package dependency range** such as `^0.1.0`."

> **Dev:** "Should every package publish run Electron E2E?"
> **Domain expert:** "No — package publish uses **Package publish validation**; app release validation is separate unless the change touches app behavior."

> **Dev:** "Is passing workspace imports enough to publish?"
> **Domain expert:** "No — use **Package manager smoke tests** against packed tarballs."

> **Dev:** "Can API compatibility be checked only by export smoke tests?"
> **Domain expert:** "No — include **Package API snapshots** so unintended public declaration changes fail validation."

> **Dev:** "Must Package API snapshots use one specific third-party tool?"
> **Domain expert:** "Prefer API Extractor-style reports when practical, but a deterministic repo-owned **Package API snapshot check** is acceptable if API Extractor adds friction."

> **Dev:** "Should user-facing package docs explain API snapshot tooling?"
> **Domain expert:** "No — **Package API snapshots** are internal validation artifacts; user-facing docs explain package purpose, installation, documented exports, and examples."

> **Dev:** "Should package-only changes go into the desktop app changelog?"
> **Domain expert:** "No — each **OpenWaggle publishable package** has its own **Package changelog** and **Package release tag**."

> **Dev:** "Should package release tags include the npm scope?"
> **Domain expert:** "No — use short **Package release tags** such as `extension-sdk-v0.1.0`, not scoped tags with `@openwaggle/`."

> **Dev:** "Should multiple package releases share one GitHub Release?"
> **Domain expert:** "No — each released package gets its own **Package GitHub release**, even if one Release Please PR released multiple packages."

> **Dev:** "Do public package engines follow the Electron app's Node 24 requirement?"
> **Domain expert:** "No — every publishable package uses the shared Node.js `>=22.19.0` **Package engine baseline**."

> **Dev:** "Is the package README enough documentation?"
> **Domain expert:** "No — each publishable package also needs a comprehensive **Package documentation page** on openwaggle.ai."

> **Dev:** "Should package READMEs be generated from openwaggle.ai docs?"
> **Domain expert:** "No — keep a concise hand-maintained **Package README**, and keep comprehensive guidance in the **Package documentation page**."

> **Dev:** "Where do users learn which OpenWaggle packages exist?"
> **Domain expert:** "In the **Packages documentation section** on openwaggle.ai."

> **Dev:** "Should package install/API/versioning docs live inside extension authoring guides?"
> **Domain expert:** "No — keep package install and API usage docs in the **Packages documentation section** and link from extension authoring guides where needed."

> **Dev:** "Should every package release whenever the app releases?"
> **Domain expert:** "No — each publishable package has an **Independent package version**, and the shared workflow publishes only packages whose public contract changed."

> **Dev:** "If Waggle core changes, does Pi Waggle publish too?"
> **Domain expert:** "Yes — the **Pi Waggle package** gets a **Dependent package bump** because it depends on the changed **Waggle core package**."

> **Dev:** "If the Extension SDK changes, does Extension React publish too?"
> **Domain expert:** "Yes — the **Extension React package** gets a **Dependent package bump** because it depends on the changed **Extension SDK package**."

> **Dev:** "Should the packages start at the desktop app version?"
> **Domain expert:** "No — their **Initial public package version** is `0.1.0`, separate from the app release train."

> **Dev:** "Can we publish first under a temporary npm scope if `@openwaggle` is blocked?"
> **Domain expert:** "No — the first public release waits until the `@openwaggle` **Package namespace** is owned and configured."

> **Dev:** "Should CI publish packages directly once validation passes?"
> **Domain expert:** "Only after the **Package release PR** is merged — then use **Trusted package publish** with the exact validated tarball."

> **Dev:** "Can a maintainer manually dispatch a workflow to publish any package version?"
> **Domain expert:** "No — recovery requires an exact **Package release tag**, and ordinary publication comes from the Release Please-created **Package publish event**."

> **Dev:** "Why does bootstrap publish a placeholder locally?"
> **Domain expert:** "npm requires an existing package record before trust can be configured; the **Package namespace bootstrap** is setup-only, while every real version uses **Trusted package publish**."

> **Dev:** "Can the publish workflow discover npm auth problems only when publishing?"
> **Domain expert:** "No — use a **Package provenance gate** before publication so missing OIDC or trusted-publisher setup fails early."

> **Dev:** "Should we maintain separate human and agent docs in the repo?"
> **Domain expert:** "No — user-facing docs are the source of truth, and **Agent-facing installed documentation** is generated from them into a Pi-style package-local docs directory for installed builds."

> **Dev:** "How should an agent find the extension API docs in a packaged app?"
> **Domain expert:** "Start from the **Installed docs index**; it maps common topics to stable package-local paths."

> **Dev:** "Should an agent hardcode the packaged docs path?"
> **Domain expert:** "No — use the **Docs discovery capability** to resolve documentation topics to local paths."

> **Dev:** "Is docs discovery only for extensions?"
> **Domain expert:** "No — it also belongs in the **Self-modifying agent context** so agents can inspect installed OpenWaggle contracts."

> **Dev:** "Can an extension package ship docs?"
> **Domain expert:** "Yes — use **Extension package documentation** in a Pi-style package-local `docs/` directory, exposed through an extension namespace with provenance metadata."

> **Dev:** "Are untrusted extension docs hidden from docs discovery?"
> **Domain expert:** "No — local docs are discoverable; trust and lifecycle are metadata, not visibility gates."

## Flagged ambiguities

- "notification" was used for both an announcement the agent sends and a request that holds the run. Resolved: an **Agent notification** can never be answered and lives in the **Notification stack**; an **Authorization request** or user-input request holds the run and docks to the composer.
- "composer-adjacent notifications" was chosen from a design prototype and later reversed on purpose. Resolved: notifications float clear of the composer so that everything docked to the composer is something the user must answer.

- "MCP extension" can imply that MCP lifecycle belongs to a Pi or OpenWaggle extension package. Resolved: use **OpenWaggle MCP integration** for the product and **MCP runtime** for the per-session client lifecycle.
- "MCP enabled" can mean desired configuration or applied runtime state. Resolved: use **MCP desired state** for the user's request and report separately whether the safe boundary has applied it.
- "Code Mode" can imply arbitrary code or a provider feature. Resolved: use **MCP orchestration** for OpenWaggle's confined provider-independent multi-call capability.
- "MCP App" can imply an OpenWaggle extension. Resolved: standard Apps run in an **MCP App host** and never receive the Extension SDK merely by rendering.
- "desktop session permissions" can imply ambient authority from an open window. Resolved: cross-session work uses **Session Control** with an explicit **Session capability grant**; the target keeps its own execution profile.
- "steer" previously meant cancelling the active run and starting a later run with the selected message. Resolved: a **Steering message** stays inside the targeted active run, while a **Run replacement** is an explicit separate operation.
- "queue" can mean Pi's internal steering and follow-up arrays or OpenWaggle's pending next turns. Resolved: the **Follow-up queue** is the session-owned product concept; Pi queues are adapter mechanisms.
- "GUI queue" can imply renderer-owned transient state. Resolved: every interface uses the same durable **Follow-up queue** through **Session Control**.
- "CLI session control" can imply a second runtime or direct database writes. Resolved: the CLI is a client of the single **Session Host** through the **Local Session transport**.

- "lane" was used to mean both placement and execution model. Resolved: use **Extension contribution surface** for placement and **Extension contribution runtime** for loading/execution.
- "trusted-react" was used as a general visual-extension model. Resolved: use **Federated module runtime** as the general model; framework choices such as React, Vue, Preact, or plain DOM are implementation choices inside the contribution.
- "custom tool UI" can imply a separate OpenWaggle tool runtime. Resolved: tools remain Pi-native; OpenWaggle extensions add **Agent-loop contributions** for desktop rendering and feedback.
- "tool renderer id" can mean either a UI contribution id or the runtime event it renders. Resolved: use **Agent-loop binding identity** for the Pi-native event and contribution id for the package-local UI entry.
- "interactive tool UI" can imply renderer-owned state mutation. Resolved: **Interactive agent-loop contributions** collect feedback, but responses return to Pi through the brokered interaction path.
- "custom interaction" can imply Pi TUI component execution. Resolved: OpenWaggle renders **Custom desktop interactions** instead of running Pi TUI components in Electron.
- "fallback" can imply best-effort logging only. Resolved: standard Pi interactions need functional **Agent-loop fallback renderers**; custom interactions without renderers fail explicitly instead of hanging.
- "shared extension state" can imply durable transcript state. Resolved: **Agent-loop durable state** comes from Pi session data; extension-owned state is reconstructable UI enhancement unless explicitly persisted through storage capabilities.
- "raw Pi event" can imply renderer imports from Pi packages. Resolved: renderer extension code consumes **Agent-loop event DTOs** with Pi-native identifiers preserved.
- "extension SDK package" can imply all OpenWaggle extension implementation code. Resolved: the **Extension SDK package** exposes author-facing contracts and helpers only.
- "extension UI" can imply either framework-neutral style helpers or React components. Resolved: React components belong in the optional **Extension React package**.
- "extract package" can imply copying app source into publish output. Resolved: a publishable package owns **Canonical package source**.
- "Waggle package" can imply either runtime-agnostic policy or Pi integration. Resolved: **Waggle core package** is reusable policy; **Pi Waggle package** is the Pi-specific one-package install path.
- "package publishing workflow" can imply Changesets because it supports independent versions. Resolved: use the **Release Please package workflow** to match ts-match.
- "OpenWaggle release" can mean npm packages or desktop app artifacts. Resolved: **Release Please package workflow** handles npm packages; **App release workflow** handles desktop artifacts.
- "fully automated package release" can imply that every merge publishes immediately. Resolved: merging the **Package release PR** is the explicit gate, after which **Trusted package publish** is unattended.
- "local bootstrap publish" can imply a supported release fallback. Resolved: **Package namespace bootstrap** creates setup-only placeholders; real versions publish only through **Trusted package publish**.
- "package build" can imply publishing repository TypeScript files. Resolved: publish **Dual package output** instead.
- "publish the packages together" can imply bundling separate package APIs into one artifact or forcing lockstep versions. Resolved: publish separate **OpenWaggle publishable packages** with **Independent package versions** through one **Package publishing workflow**.
- "agent docs" can imply a second hand-maintained documentation tree. Resolved: **Agent-facing installed documentation** is generated from the user-facing docs and installed runtime docs.
- "installed docs" can imply a copied folder with no entry point. Resolved: installed docs must include an **Installed docs index** with predictable topic routing.
- "docs path" can imply a fixed filesystem location. Resolved: agents should use the **Docs discovery capability** instead of hardcoding packaged paths.
- "untrusted extension docs" can imply hidden local docs. Resolved: **Extension package documentation** is discoverable with provenance metadata regardless of trust or enablement.
- "branch" is ambiguous between conversation forks and git. Resolved: a **SessionBranch** is a conversation-tree fork of the Pi message tree; a **Session worktree** is a managed git checkout backing one shareable **Workspace resource**. Sessions bind to a Workspace explicitly, and the Workspace—not a session or conversation branch—owns worktree lifecycle and branch identity.
- "turn diff" could imply either a git commit range or exclusive authorship. Resolved: a **Turn diff** is computed from persisted per-turn **Turn checkpoints** over the bound Workspace. It works for uncommitted edits, but an overlapping shared-Workspace interval is marked as observation rather than exclusive attribution.
- "worktree sidebar" was used for the diff panel's file list, which collides with **Session worktree** (a git worktree). Resolved: that list is the **Changed-file navigator**; it is scoped to the active diff and has no relationship to git worktrees.
- "theme" is ambiguous between the contract, a selectable instance, and the object handed to extensions. Resolved: the **Design token contract** is the versioned role set, an **Appearance** is a selectable instance of it, and the extension theme object is one projection of an Appearance across the SDK boundary.
- "mode" is ambiguous between appearance polarity and git isolation. Resolved: **Colour scheme** is light-or-dark polarity; **Session environment mode** is `local` versus `worktree` git isolation.
- "pin" was used for both projects and sessions (issue #97 was written as project pinning). Resolved: only sessions are pinnable. A **Pinned session** is reachable by one **Pinned shortcut**, whereas a pinned project never could be — it has no single thing to open.
- "pinned order" conflated two ideas. Resolved: **Manual order** is the sequence the user drags and owns; **Pinned sort** is the rule currently ordering the section. Switching **Pinned sort** away from Manual and back must return the user's **Manual order** unchanged.
