---
status: accepted
---

# Provider restrictions bind every surface that resolves a model

Date: 2026-11-17

OpenWaggle sessions run on any provider the person has signed in to, everywhere. One machine that
mixes a personal provider with an employer's (Bedrock through the company AWS account, say) needs
each project's sessions to run on the right account, and a model that bills the wrong one is a
leak, not an inconvenience. `multiAgentEnabledByProject` shows the existing shape for a
project-scoped restriction, but the codebase deliberately narrows that one to the agent's Hive
tool: it "does not disable GUI, CLI, or external MCP". A model choice must not follow that
precedent. The GUI passes its pick explicitly at launch, agents name models when spawning, the CLI
takes `--model`, and external MCP callers name models too, so a restriction that binds only one
surface leaves the other three as leaks.

## Decision

- **The unit is the provider, not the model.** A restriction says which Pi providers a project's
  sessions may use (`parseModelRef` splits the provider from the id). Models are curated per
  person in `enabledModels`; a restriction only narrows which of them a project offers, and never
  edits that list.
- **One list of scopes, keyed by absolute path.** The app-wide choice, any folder, and a single
  project are the same kind of entry. A session's nearest containing scope decides each provider,
  and the project's own `.openwaggle/settings.json` `providers` scope outranks every app-side one.
  A scope may close itself with the reserved `only` list, permitting exactly the providers it
  names; otherwise `true` grants, `false` withdraws, and a provider no scope mentions is allowed.
- **Refuse what the caller named; re-derive what OpenWaggle derived.** A model the caller named —
  a specialization, an Agent definition's `model`, a CLI or MCP `--model`, a Heartbeat's own
  model, a Waggle agent's own model — fails the request with the provider it refuses. A model OpenWaggle derived — the global default, a project default, a
  spawned child's inheritance, a fork's source model — resolves again inside the project's
  restriction to the first enabled model of an allowed provider, so a multi-agent spawn crossing a
  scope boundary keeps working. The Title model falls back to Automatic rather than failing,
  because titles are cosmetic.
- **Every surface goes through one choke point.** Session lifecycle preparation resolves the model
  for create, launch, spawn and fork from GUI, CLI, MCP and the Hive tool alike, so the
  restriction is enforced there once, and a running session is never retroactively affected. The
  two places a Run swaps in a model of its own check it as well: a Heartbeat's model when it
  fires, since a scope can narrow after it was scheduled, and a Waggle agent's model when the
  Waggle Run starts.
- **The home directory is the app-wide setting, not a scope.** A path scope must name a folder
  inside the home directory and outside OpenWaggle's own configuration, or the settings update is
  refused; the Settings form and the update share one check.

## Considered Options

- **A per-project enabled-model set instead of per-provider restrictions.** It matches the model
  picker's own unit, but it re-creates `enabledModels` per project, and a new model under an
  allowed provider would then need enabling in every project that allows its provider.
- **Bind the agent's Hive tool only, like `multiAgentEnabledByProject`.** It follows the closest
  precedent, but the GUI names its model at launch, so the leak the feature exists for survives
  it.
- **Refuse inherited models on spawn.** It would make a violation loud, but it fails every
  cross-scope spawn, which is the common multi-agent case, and the parent's model is OpenWaggle's
  own derivation, not the caller's decision.

## Consequences

The settings store gains `providerRestrictions` and `providerRestrictionsByPath`, and the project
settings file gains a `providers` scope, so an existing install is unrestricted until it opts in
(empty scopes allow every provider). The composer's picker filters by the project's restriction
and explains when no enabled model remains, the settings update validates scope paths, and a
provider restriction never changes `enabledModels`. Machine-local enforcement like a user's
extension can block provider traffic outside OpenWaggle entirely, but it cannot distinguish named
from derived choices, refuse with an actionable error, or follow a moved folder through project
path aliases, which this decision does in the product.
