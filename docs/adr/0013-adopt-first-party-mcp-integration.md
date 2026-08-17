# Adopt First-Party MCP Integration

Status: accepted

OpenWaggle will replace the `pi-mcp-adapter` package extension with a first-party MCP integration owned by OpenWaggle. Pi remains the only agent/model loop. OpenWaggle owns MCP configuration, lifecycle, protocol negotiation, transports, authentication, trust, authorization, context policy, persistence, user experience, client behavior, and optional server behavior. A first-party inline Pi extension factory exposes the selected OpenWaggle MCP tools to Pi without copying a package, mutating Pi settings, or installing an extension.

This decision supersedes only the MCP ownership clauses in ADR-0002. It does not create a parallel agent runtime, provider registry, model registry, auth registry, or session history. Provider and model truth continues to flow from Pi through OpenWaggle ports, and Pi session data remains the runtime source of truth.

The product is called the **OpenWaggle MCP integration**. The per-session client and lifecycle subsystem is the **MCP runtime**. Product UI must not call it the Pi MCP extension.

## Lifecycle And Scope

- MCP is off globally by default. Effective state resolves `session -> project -> global`, with project and session values supporting `inherit`, `on`, and `off`.
- Off means no server connection, local server process, model-facing MCP tool, server instruction, resource subscription, proactive event channel, or MCP-derived context. Cached management metadata may remain visible in Settings but never enters the agent context while disabled.
- A user may change desired state at any time. Idle sessions apply it immediately. Active turns keep an immutable turn snapshot; a pending change applies at the next safe boundary. Running child operations may settle, but no new MCP child calls start after a disable boundary.
- Configuration, authentication, catalog, schema, and trust changes use the same immutable-turn rule. Expired credentials may refresh within the snapshot, but a changed schema invalidates an undispatched handle. Calls with uncertain side effects are never retried automatically.
- Server definitions are declarative requests. User-local state owns trust, authentication, enablement, grants, and runtime health. A checked-in `.mcp.json` may request servers but cannot grant authority or embed executable shell strings.
- `.mcp.json` uses executable plus argument arrays for local servers, project-relative paths, secret references, no includes, and no scripting. Unknown fields are preserved for round-tripping but ignored and reported.
- Global, project, and session configuration remain independently inspectable. Effective configuration includes provenance for every resolved field.

## Model-Facing Surface

- The default surface is a compact, catalog-free `mcp` gateway with `list`, `search`, `describe`, and `call` operations. Initial context contains no server names, tool schemas, server instructions, or cached catalog entries.
- Search runs over the active turn's in-memory catalog and does not transmit the user's search query to an MCP server. No catalog persistence is required; any future persistent catalog cache must be encrypted. Connecting to a server remains lazy and requires effective enablement, trust, and policy.
- Discovery returns opaque, revision-bound handles tied to server identity, negotiated protocol, catalog revision, schema hash, session, and turn snapshot. Aliases are mutable display names and are not identity.
- Direct model-visible MCP tools are an explicit per-server or per-tool opt-in. They never become the compatibility fallback for a model that cannot use the gateway.
- `mcp_run` provides provider-independent MCP orchestration through an ordinary JSON-schema tool. Its preferred `code` input runs a parsed, restricted JavaScript-like language over only literal opaque MCP handles. The prior `{ mode, calls }` JSON plan remains a deliberate compatibility input, not the primary runtime.
- MCP orchestration is interpreted as data and never passed to `eval`, `Function`, a JavaScript VM, or a module loader. The interpreter has no Node.js, Electron, shell, filesystem, environment, credential, module, import, timer, prototype, or direct-network binding; MCP calls cross its only effectful boundary through a typed host callback.
- Each orchestration has hard wall-time, execution-step, memory, output, child-call, nesting, and concurrency budgets. Every child call retains an individual id, status, progress, cancellation path, provenance, approval, outbound-data review, and audit entry. Approval of `mcp_run` never approves its children.
- Intermediate orchestration results stay out of model context but remain inspectable in an expandable user-visible activity tree. The final projection preserves source attribution and sensitivity metadata.
- Long-running work returns an MCP Task instead of holding a short orchestration open indefinitely.

### Restricted `mcp_run` grammar

The shipped language accepts `//` and `/* ... */` comments and only these statement forms:

```text
const name = expression;
const name = await mcp.call("child-id", "opaque-handle", argumentsObject);
const [a, b] = await mcp.parallel([
  mcp.call("a-id", "opaque-handle", argumentsObject),
  mcp.call("b-id", "opaque-handle", argumentsObject)
]);
if (expression) { statements } else { statements }
return expression;
```

Expressions are JSON string, number, boolean, and null literals; arrays; object literals; immutable variable references; own-property reads using `.`; parentheses; unary `!`; and `===`, `!==`, `&&`, and `||`. Call ids and handles must be non-empty literal strings. Call arguments must evaluate to JSON objects. Binding and child ids are unique across the complete program, parallel result bindings must exactly match the call count, and computed properties are not supported.

There are no loops, functions, classes, exceptions, mutation, assignment after declaration, general function calls, dynamic property access, or language/runtime globals. In particular, syntactic references to runtime, process, filesystem, module, network, timer, import, `eval`, `Function`, `constructor`, `prototype`, or `__proto__` authority are rejected by the tokenizer or parser before execution; those words may still appear as inert string data.

The initial hard limits are 64,000 source bytes, 120,000 ms wall time, 10,000 interpreter steps, 32 child calls, depth 8, 4,000,000 bytes of working memory, 1,000,000 output bytes, and 8 concurrently executing children. The caller cancellation signal shares the wall-time cancellation path. A limit failure stops the orchestration visibly; it never relaxes a limit or falls back to unrestricted JavaScript.

## Model Compatibility

- `mcp` and `mcp_run` use ordinary tool calls and do not depend on provider-native Code Mode. Pi 0.80.6 exposes no per-model tool-support bit or capability probe: `Model<Api>` is its chat/tool-capable model contract, `Context` carries optional tools, the coding agent supplies tools by default, and every installed built-in API implementation consumes `Context.tools`.
- Successful resolution through Pi's `ModelRegistry` is therefore the sole model-capability gate. Every resolved Pi model receives the MCP tools selected for that turn. OpenWaggle does not invent provider/model-name heuristics or maintain a parallel tool-capability registry.
- A custom API provider that registers a `Model<Api>` promises the same tools and tool-call event contract. If it violates that contract, the run fails visibly rather than silently removing MCP tools or falling back to prompt/XML emulation. The MCP UI explains that the user must switch to a conforming model or fix the provider; user-invoked prompts, resources, Apps, and management remain available.
- If a future Pi contract represents a tool-less model explicitly, OpenWaggle must honor Pi's field at the same registry boundary, inject no agent MCP tools, and expose the exact impact and recovery action. Until Pi represents that state, OpenWaggle does not fabricate it.
- OpenWaggle never emulates tool calls with prompt/XML conventions, silently changes model, or silently downgrades the tool surface.

## Protocol And Capability Policy

- The primary protocol target is MCP `2026-07-28`, using stateless request handling and Model Runtime Tool Requests where negotiated. Every connection defaults to automatic era and version negotiation: it probes `server/discover` for `2026-07-28`, then conservatively falls back to the legacy `initialize` handshake for `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07`. A user may pin a revision for diagnosis or strict interoperability; a pin fails loudly instead of falling back.
- Modern tools, prompts, resources, Apps, elicitation, authorization, notifications, Tasks, and experimental remote Skills are first-class capability families with independent negotiation and policy.
- Legacy sampling, roots, logging, stateful HTTP/SSE, WebSocket, and vendor-specific channel behavior are compatibility modules only. Their presence never weakens modern defaults.
- Legacy sampling is disabled unless explicitly enabled for a server. Every request receives fresh, reviewed consent; the server cannot select unrestricted models, secrets, tools, or context.
- Legacy roots are read-only compatibility hints and never filesystem authority. Effective filesystem grants come from OpenWaggle policy.
- Standard subscriptions update state only. Proactive external events enter a separate opt-in **MCP Event Inbox**. The default action is notification; editable drafts or automation turns require explicit channel policy and cannot approve remote actions.
- Prompts are user-invoked and create attributed editable drafts. They are never silently injected or automatically executed.
- Resources are browsed or attached by the user or by an authorized gateway call. They remain attributed, untrusted external content.
- Server instructions are bounded, attributed, untrusted, never part of startup context, and loaded only when relevant. They cannot override system instructions, security policy, trust, approvals, or secret handling.
- Tool annotations are planning hints, not authorization. Input and output use bounded JSON Schema 2020-12 validation with no uncontrolled external references. Invalid outputs fail visibly.
- Experimental remote Skills implement the draft SEP-2640 `io.modelcontextprotocol/skills` extension through `skills/list`, `skills/get`, and ordinary resource reads. They are disabled unless both the server declares the extension and its OpenWaggle definition explicitly sets `clientCapabilities.remoteSkills: true`.
- Remote Skill names are origin-scoped and never shadow local or other-server Skills. `SKILL.md` bytes are checked against the advertised SHA-256 digest, frontmatter is compared field-by-field with the advertised entry, and every read remains bound to the originating server. A changed manifest revokes any prior content-bound approval. Dynamic Skills without a manifest are visibly unverifiable and never receive persistent approval.
- Remote Skill content remains fully attributed and untrusted. Loading it requires fresh user action; nested Skills require separate action. Remote scripts are never executed, remote `allowed-tools` is never granted automatically, and remote Skill cache paths cannot participate in local filesystem Skill discovery.

## Tasks And Disable Semantics

- MCP Tasks are durable OpenWaggle records with server identity, remote task id, protocol revision, config/schema hash, status, progress, result metadata, and provenance.
- Disabling a server stops polling and subscriptions but does not pretend the remote task stopped. The UI explains that it may still be running remotely and offers supported cancel or wait actions.
- Results completed while disabled are retained for explicit inspection but do not enter agent context until the user re-enables and selects them.
- Ordinary calls are bounded. Work expected to exceed ordinary budgets must use Tasks when the server supports them.

## Transports, Network, And Authentication

- First-class client transports are `stdio` and 2026 Streamable HTTP. The same transports negotiate supported 2025 and 2024 protocol revisions. Legacy stateful HTTP/SSE and WebSocket are labeled compatibility transports for servers whose wire transport predates Streamable HTTP; SSE is supported for the migration period and never selected silently after an unrelated modern-transport failure.
- Local commands are executable plus argument arrays and never pass through a shell. Child processes receive a minimal explicit environment and an adapter-controlled executable path.
- Non-loopback remote endpoints require HTTPS or WSS. Plain private-network HTTP requires an explicit local or organization exception. Unix sockets and Windows named pipes are supported as local transports.
- Redirects are disabled for the 2026 transport. Compatibility redirects are bounded, same-origin, revalidated, and strip credentials when authority changes.
- DNS resolution is checked for address-class changes and rebinding. OAuth authorization, token, registration, redirect, and metadata URLs are independently validated and do not inherit trust from the MCP endpoint.
- System certificate trust is the default. Custom certificate authorities and mutual-TLS credentials live in the encrypted vault. Proxy use and effective destination remain visible.
- Remote authorization supports OAuth authorization code with PKCE and Client ID Metadata Documents. Dynamic Client Registration remains a compatibility path. Client Credentials and Enterprise-Managed Authorization are supported when negotiated and allowed by organization policy.
- Access, refresh, client, API, mTLS, and proxy credentials never enter model-visible configuration, logs, diagnostics, CLI arguments, or MCP Apps.
- Elicitation is fresh per request and reviewed. Sensitive input uses the URL flow. Non-loopback elicitation URLs require HTTPS.

## Trust, Sandboxing, And Permissions

- Trust is fail-closed and tied to immutable OpenWaggle server instance identity, transport, executable/endpoint, package digest where applicable, effective config hash, requested capabilities, and security profile.
- A configuration or package change invalidates affected trust and grants. Server self-reported `serverInfo` is recorded as a claim, not identity.
- Local stdio servers run constrained by default: configured roots read-only, isolated temporary write space, no network, and minimal environment. Additional roots, write access, network domains, devices, and unsandboxed execution require explicit grants.
- There is no silent unsandboxed fallback. Unsupported sandboxing is a visible high-risk state requiring an explicit action.
- Capability approvals are bound to server identity, tool/schema hash, project/session scope, outbound destination, and data classes. Organization policy is a ceiling and cannot silently enable a server; it may visibly require a managed workflow.
- Before an outbound call, OpenWaggle can show exact destination, arguments, selected files, size, and grants. Known secrets are blocked. Sensitive disclosure requires one-call confirmation and is never silently redacted into a different request.
- Optional server failures degrade visibly. Required server failures block the dependent workflow with impact, cause, responsible actor, next action, and recovery state.

## MCP Apps

- MCP Apps use the standard `ui://` resource and JSON-RPC bridge. They do not run as OpenWaggle extensions and receive no Extension SDK, Electron, Node.js, renderer-store, filesystem, process, or ambient network authority.
- The existing federated-module system may provide reusable sandbox-host primitives, lifecycle chrome, theme tokens, sizing, focus management, and broker transport. Extension adapters and MCP App adapters remain distinct policy boundaries.
- Rendering grants no tool authority. App-originated calls pass through the same handle, approval, outbound-data, and audit policies as model calls.
- `ui/message` creates an editable attributed draft. Model-context contributions are staged, visible, session-scoped, and opt-in.
- Device, link, download, clipboard, persistent storage, and network capabilities require explicit grants. App state, origin, and grants are isolated by server/app identity and content hash.

## Data, Context, And Retention

- MCP results included in a task become visible attributed transcript content. Disabling MCP prevents future use but does not rewrite history.
- Compaction preserves MCP attribution and sensitivity. A user may exclude prior MCP-derived content from future model context without deleting the visible transcript.
- No MCP result becomes cross-task memory by default. Forks inherit visible content but not live connections, session approvals, pending elicitation, or ephemeral grants.
- Catalog metadata is held in memory for the immutable turn and discarded with its connection. Any future persistent cache must be encrypted and must exclude credentials, result bodies, App state, and sensitive payloads. Enabled sessions refresh lazily; disabled sessions may display only separately persisted management/Task metadata and mark it stale or disabled.
- Export supports provenance and redaction. Explicit MCP data removal is separate from disabling a server and reports what was removed.
- Observability is metadata-only by default. Server stderr and logs are untrusted and bounded. Payload tracing is explicit, temporary, locally stored, redacted, and never uploaded without a separate user action.

## Management, Registry, Imports, And CLI

- Settings -> MCP is the complete management surface. The session composer shows effective state, pending changes, required failures, active Tasks, and actions needing user attention.
- Supported CLI commands include `add`, `list`, `get`, `enable`, `disable`, `trust`, `auth`, `logout`, `doctor`, `remove`, `import`, and `registry`.
- `openwaggle mcp add` creates a disabled, untrusted server definition. Secret values are never accepted directly on the command line. Machine-readable output uses stable schemas and exit codes.
- Import adapters cover Codex, Claude's command-line and desktop clients, OpenCode, Pi, VS Code, and additional recognized tools. Import is read-only, previewed, diffable, provenance-preserving, and re-runnable. It never blindly imports OAuth tokens or hidden trust state.
- Registries may be official, organization-private, or user-curated. Installation creates a disabled draft with immutable provenance: npm, PyPI, and NuGet use exact package versions; OCI uses the `sha256` repository digest returned after a pull and inspection; MCPB uses the SHA-256 of the downloaded artifact after verification. A digest copied from Registry metadata is never recorded as verified merely because it was declared. Updates display manifest, capability, permission, publisher, coordinate, and digest changes before activation.
- Supported package sources include MCPB, npm, PyPI, NuGet, and OCI where a verifiable launcher contract exists. OCI is always executed by digest, never by a mutable tag. MCPB downloads are HTTPS-only, size-bounded, SHA-256 verified before extraction, and atomically cached by digest; extraction rejects traversal, symlinks, special files, encrypted entries, and decompression-limit violations before validating the current manifest and cached launcher. Package-manager launchers use only the package manager's explicit install/execution contract, and MCPB never runs an additional install script.
- Known OpenWaggle `pi-mcp-adapter` files, package artifacts, constants, version checks, package-copy behavior, Pi-setting mutations, UI wording, and tests are removed in the clean migration. The exact OpenWaggle-owned `extensions/pi-mcp-adapter` package entry is removed from Pi settings; unrelated user-managed package entries are left untouched. Legacy global, Pi, `.agents`, project OpenWaggle, and disabled-server configuration is reported through preview-first import. Plaintext credentials discovered during import require explicit user review.

## OpenWaggle As An MCP Server

- `openwaggle mcp serve` starts an optional MCP server. It is disabled by default and never starts merely because the desktop app is open.
- The server is task-oriented. It exposes OpenWaggle agent work, durable task status/result/cancellation, and explicitly granted session-control capabilities rather than raw shell/edit tools or transparent pass-through access to every configured upstream server.
- Stdio is the default. Loopback Streamable HTTP requires pairing or an explicit credential. Non-loopback serving follows the remote transport, TLS, OAuth, proxy, and organization-policy requirements above.
- Each connection has an authenticated caller identity, revocable capability profile, project/session constraints, rate/fan-out limits, and audit provenance.
- Approvals remain OpenWaggle-owned. A client cannot inherit desktop approvals or answer on the user's behalf unless an explicit scoped delegation permits it. When no trusted approval UI is available, the task pauses and reports required action.
- Origin chains, depth limits, and self-target checks prevent recursive OpenWaggle/MCP loops.
- Server resources expose only explicitly shared artifacts or task results, never an enumerable view of private desktop sessions.

## Session Control

- Cross-session orchestration is a first-party OpenWaggle domain service, not an MCP-owned session store and not a loopback call through OpenWaggle's own MCP server.
- The compact agent-facing `sessions` surface supports listing/status, paginated reading, creation, worktree creation, forking, messaging/steering, waiting, interruption, handoff, rename, pin, and archive.
- Internal desktop agents may discover same-workspace non-archived session metadata by default. Reading across projects, sending messages, interrupting, or reorganizing sessions requires an applicable permission grant.
- External server profiles may grant `sessions:discover`, `sessions:read`, `sessions:create`, `sessions:message`, `sessions:interrupt`, and `sessions:organize`, constrained by workspace, ancestry, or explicit session ids. Server startup requires at least one explicit workspace or session scope; an empty scope never implies access to every session.
- A controlling session cannot elevate the target. The target executes under its own model, project, tool, MCP, filesystem, network, and approval profile. Prior credentials, trust, and “always allow” decisions do not transfer.
- Cross-session actions show source identity, target, effect, and a link to the affected session. Self-messaging is rejected and burst fan-out is bounded.

## Consequences

- The current MCP config port and adapter are replaced by explicit domain, port, application-service, adapter, persistence, IPC, preload, renderer, CLI, and Pi-projection boundaries.
- MCP SDK imports belong in first-party MCP infrastructure adapters, while Pi SDK imports remain under `src/main/adapters/pi/` or dedicated Pi packages.
- The MCP runtime must be testable without Electron, Pi, live servers, or real credentials. Protocol, transport, policy, and persistence ports require deterministic fakes.
- The compatibility matrix is executable: official MCP conformance fixtures, negotiated-version fixtures, reference servers, malformed peers, transport interruption, OAuth, sandbox, App, Task, and orchestration tests are release gates.
- Renderer, preload, IPC, Pi, child-process, and packaged-app behavior require real Electron verification in addition to unit and integration tests.
- User-facing documentation must cover enablement scope, server management, permissions, Tasks, Apps, imports, CLI, server mode, session delegation, troubleshooting, data retention, and recovery.
