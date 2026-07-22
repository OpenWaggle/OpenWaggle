# OpenWaggle Context

OpenWaggle is an Electron desktop coding-agent workspace built on Pi. This glossary captures product-domain language that should stay stable across planning, issues, docs, and implementation.

## Language

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

**Transcript agent-loop surface**:
The durable chat-transcript surface for rendering Pi tool progress, tool results, approvals, and custom agent-loop messages.
_Avoid_: ephemeral-only tool UI

**Blocking agent-loop interaction**:
An Interactive agent-loop contribution that pauses Pi progress until the user responds.
_Avoid_: hidden prompt

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
OpenWaggle-owned live state for a Pi interaction request waiting for user feedback.
_Avoid_: extension-local pending prompt

## Relationships

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
