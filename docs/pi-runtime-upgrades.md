# Pi runtime upgrades

Pi publishes its runtime as one matched release: nine packages (`pi-agent-core`, `pi-ai`, `pi-client`, `pi-codemode`, `pi-coding-agent`, `pi-mcp`, `pi-protocol`, `pi-telemetry`, `pi-tui`) plus `@earendil-works/chord`. OpenWaggle keeps its direct Pi dependencies in the `pi-runtime` pnpm catalog, patches `pi-ai` and `pi-coding-agent`, and bundles Pi into the Electron main process. `pnpm check:pi-runtime` (`scripts/check-pi-runtime-alignment.ts`) enforces the matched set, the direct pins, the patch registrations, and the release-age exceptions described below.

## What the patches carry

The patches are larger than ADR 0025's compaction behaviour. Re-port every part on each upgrade, and keep every change additive to Pi's public contracts.

- **Native Responses compaction (ADR 0025).** `compactResponses` in pi-ai, the compaction-capable model id lists in `openai.models.js` and `openai-codex.models.js` (audit them against the new catalog; drop ids the catalog no longer has), the Native endpoint fallback (404/405/501, and 400/401/403 under Sign in with ChatGPT), credential fingerprinting, request-model refresh, reconstruction fit, compaction threshold injection, and the retry policy and callbacks.
- **Session projection.** `buildSessionProjection(targetModel)` and the reconstruction entries in the session manager.
- **Provider attribution.** Prepared provider headers for Native compaction requests (`withPreparedProviderHeaders`).
- **Prompt and steer.** The input hook runs before extension-command dispatch, `PromptOptions.transformExpandedText` rewrites the expanded text, `prompt()` resolves to the text it queued while streaming, and `steer(text, images, transform)` resolves to the exact queued text (or undefined when an input handler consumed it). The options form of `steer()` keeps Pi's `queued`/`handled` disposition. `PromptOptions.streamingOnly` makes `prompt()` reject with code `agent_not_streaming` instead of starting a new turn when the active turn ended while input handlers ran.
- **Custom-message turns.** `sendCustomMessage(message, { triggerTurn: true })` starts the turn through `_runCustomMessageTurn`, which runs `before_agent_start`, `_prepareNewTurn` (request auth refresh and the pre-prompt compaction check), `_preparePromptAndToolLoadout`, and `_runSystemPromptOptions` as `prompt()` does, on every Waggle turn. When that preparation throws, such as request auth that no longer resolves, `_runFailedCustomMessageTurn` runs the message as a turn whose first request fails, so the turn still ends with an error turn and `agent_end` instead of rejecting a `pi.sendMessage` nobody awaits. Unpatched, such a turn sends no system prompt when the transcript has none, and the turn's tool-loop requests diff named extension sections away (Pi rebuilds them from the base options). Waggle starts every turn this way, so without it a Waggle-first Session's first request has no system prompt at all. This is an upstream Pi bug to report; drop the hunk once Pi fixes it.
- **Model selection.** `setModel`/`cycleModel` check Pi's provider auth first and accept providers whose auth resolves without an API key (Amazon Bedrock through `AWS_PROFILE`, an ECS task role, web identity).
- **Virtual models.** A virtual selection stays unresolved in agent state, its compactions always use the Portable mechanism, and a routed native-capable model never reaches the Native endpoint.
- **MCP exports.** pi-coding-agent's `dist/index.js` and `dist/index.d.ts` also export Pi's MCP sign-in (`createMcpAuthProvider`, `McpOAuthCredentialStore`, `McpSignInCancelledError`, `signInMcpServer`), validation (`getMcpToolExposure`, `isMcpToolName`, `mcpNamespace`, `validateMcpServerConfig`), and value resolution (`resolveConfigValueOrThrow`, `resolveHeadersOrThrow`) for ADR 0050. Exports only, no behaviour change, but re-add them on every upgrade: the hunk sits at the end of `dist/index.js` and does not apply with git's default context, so check the module paths still exist in the new release.

## Bundled main process

Pi resolves several files from `import.meta.url`, which in the bundle is OpenWaggle's `out/main`. Check each of these still works after an upgrade; `pnpm pi-main-bundle:smoke` (part of `pnpm check`) and `pnpm packaged-app:smoke` cover them.

- `scripts/vite/pi-worker-bundles.ts` emits Pi's codemode sandbox worker (`codemode-worker.js`, an ES module run from a `data:` URL) and image-resize worker (`image-resize-worker.js`) beside the main bundle. A new Pi worker entry needs an entry there.
- QuickJS (`quickjs-wasi`) and Photon (`@silvia-odwyer/photon-node`) are root dependencies pinned to the exact versions Pi depends on, because their wasm is read from the installed package. On each upgrade, set both root pins to the versions in the new `pi-codemode` and `pi-coding-agent` package.json files; `check:pi-runtime` fails when a pin drifts or the lockfile resolves more than one version.
- `src/main/apply-pi-package-directory.ts` sets Pi's `PI_PACKAGE_DIR` to Pi's installed package before any Pi module loads, so Pi's README, docs, themes, export templates, and `VERSION` come from Pi and not from OpenWaggle's package.json. Shells OpenWaggle starts get the user's own value back.
- electron-builder keeps Pi's README, docs, and examples (`scripts/electron-builder-pi-assets.ts`), and `asarUnpack` keeps both workers and both wasm packages unpacked.
- Bundler-opaque lazy loaders (OAuth flows, the Bedrock implementation) need static registration (`pi-bundled-oauth.ts`, `pi-bundled-bedrock.ts`).

## Update procedure

1. Check that every package publishes the same newest version:

   ```bash
   for package in chord pi-agent-core pi-ai pi-client pi-codemode pi-coding-agent pi-mcp pi-protocol pi-telemetry pi-tui; do
     pnpm view "@earendil-works/$package" version
   done
   ```

2. Review every Pi changelog section since the pinned release. Pay special attention to provider context, compaction, retry, queue, prompt, steering, model selection, virtual models, MCP, codemode, session-format changes, and provider renames (stored provider references need an OpenWaggle migration, as for Azure in 1.0.3).
3. Update every entry in `catalogs.pi-runtime`. If the release is younger than pnpm's seven-day `minimumReleaseAge`, add exact `minimumReleaseAgeExclude` entries for exactly the matched-release packages the lockfile resolves (with `chord`; `check:pi-runtime` rejects missing and unneeded entries) and a `# pi-runtime-release-age-exclusions-expire: YYYY-MM-DDTHH:MM:SSZ` line naming a UTC time at or after the moment the last-published package of the release is seven days old (`npm view <package> time`; a bare `YYYY-MM-DD` means midnight UTC). `check:pi-runtime` fails from then until the entries and the line are removed, and also when the line outlives its entries.
4. Remove the two old `patchedDependencies` registrations and install the unpatched target release with `pnpm install --ignore-scripts`.
5. Port the patches. `pnpm patch` prompts interactively when a package is installed as more than one peer variant, so do not rely on it. Instead, copy the pristine target tarball into a scratch git repository, apply the old patch with `git apply --reject`, resolve every rejected hunk by reading the target release's code (never by fuzz), and write the new patch with `git diff --full-index --src-prefix=a/ --dst-prefix=b/` restricted to the changed `dist` files. Save it as `patches/@earendil-works__<package>@VERSION.patch` and register it in `patchedDependencies`.
6. Delete the superseded patch files, run `pnpm install --ignore-scripts` to refresh `pnpm-lock.yaml` and the patch hashes, and verify alignment with `pnpm check:pi-runtime`.
7. Run the focused Pi compaction, reconstruction, retry, prompt, steering, model-switch, virtual-model, scheduling, and settlement tests, then `pnpm pi-main-bundle:smoke`, before the repository verification matrix. For packaging changes, also run `pnpm build:unpack` and `pnpm packaged-app:smoke`.
