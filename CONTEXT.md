# OpenWaggle Context

OpenWaggle is an Electron desktop coding-agent workspace built on Pi. This glossary captures product-domain language that should stay stable across planning, issues, docs, and implementation.

## Language

**OpenWaggle extension package**:
A first-class local package that can add OpenWaggle desktop contributions and optionally Pi runtime resources.
_Avoid_: plugin, addon

**Development extension fixture**:
An extension package used only for local QA, tests, or demos and never shipped as product content.
_Avoid_: bundled extension

**OpenWaggle desktop contribution**:
A declared addition to an OpenWaggle-owned product surface.
_Avoid_: widget, plugin component

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

**Extension SDK surface**:
The intentional public API exposed to extension code for capability calls, UI mounting context, theme data, and contribution behavior.
_Avoid_: OpenWaggle internals, renderer internals

**OpenWaggle shared extension module**:
An optional host-provided module an extension can import for SDK, theme, or UI convenience when using a federated module runtime.
_Avoid_: required framework dependency

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

## Relationships

- An **OpenWaggle extension package** declares zero or more **OpenWaggle desktop contributions** across one or more **Extension contribution surfaces**.
- A **Development extension fixture** may be copied into a project for manual QA, but it is not an installed or bundled product extension.
- An **OpenWaggle desktop contribution** has exactly one **Extension contribution surface**.
- An **Extension contribution surface** is rendered inside an **Extension contribution container**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension contribution runtime**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension execution placement**.
- A **Federated module runtime** receives an **Extension SDK surface** instead of importing OpenWaggle internals.
- A **Federated module runtime** may use **OpenWaggle shared extension modules**, but the required contract is the **Extension mount context**.
- A **Federated module runtime** starts by calling the extension module with an **Extension mount context**.
- The **Extension capability broker** authorizes calls made through the **Extension SDK surface**.
- An **OpenWaggle state read capability** exposes selected OpenWaggle state through the **Extension SDK surface**.
- An **OpenWaggle action capability** exposes selected OpenWaggle behavior changes through the **Extension SDK surface**.
- **Extension package state** can be shared by multiple **OpenWaggle desktop contributions** from the same package.
- Persistent extension data is written through typed storage capabilities, not by making **Extension package state** persistent by default.
- **Extension contribution instance state** belongs to exactly one mounted contribution instance.
- OpenWaggle owns each **Extension contribution container**; the extension owns only the content mounted inside it.
- The **Composer extension surface** is constrained to compact actions and launchers instead of arbitrary composer input injection.

## Example dialogue

> **Dev:** "Should this extension add a route or a side panel?"
> **Domain expert:** "That is the **Extension contribution surface** decision; both can still use the same **Federated module runtime**."

## Flagged ambiguities

- "lane" was used to mean both placement and execution model. Resolved: use **Extension contribution surface** for placement and **Extension contribution runtime** for loading/execution.
- "trusted-react" was used as a general visual-extension model. Resolved: use **Federated module runtime** as the general model; framework choices such as React, Vue, Preact, or plain DOM are implementation choices inside the contribution.
