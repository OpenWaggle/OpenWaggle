# Pi Waggle release checklist

Run this before a release of `@openwaggle/pi-waggle` or `@openwaggle/waggle-core`, and after a Pi
upgrade. The automated part runs in CI on every pull request; the manual part loads the packed
package in the real Pi TUI, which no automated check does.

## Automated (CI)

| Check | Command | What it proves |
|---|---|---|
| Package tests | `pnpm test:unit` | `packages/waggle-core` policy (config, presets, turn sequencing, stop policy) and `packages/pi-waggle` behaviour against a fake Pi `ExtensionAPI`: command parsing, mode state, preset storage, inherited models, model switching, turn markers, renderers. |
| Desktop adapter | `pnpm test:unit` and `pnpm test:integration` | OpenWaggle runs Waggle through `@openwaggle/pi-waggle/loop` and projects mode state, turn identity and retries into the Session read model (`waggle-run-service.unit`, `session-waggle-mode-state.integration`, `waggle-turn-identity-projection.integration`, `pi-waggle-turn-retry.integration`). |
| Tarball consumers | `pnpm package:smoke` (part of `pnpm check`) | The packed tarballs install with npm, pnpm, Yarn and Bun. Every export resolves in ESM and CommonJS, a CommonJS Waggle turn settles, Pi discovers the declared extension, and Pi's host packages (the Pi SDKs and `typebox`) are `"*"` peer dependencies. |
| Desktop bundle | `pnpm pi-main-bundle:smoke` (part of `pnpm check`) | The Electron main build, which bundles `@openwaggle/pi-waggle` from source, loads the declared extension entry in a real Pi session under Node and Electron: `/waggle` and `/standard` register, the turn renderer registers, and mode state round-trips through Pi's session manager. |
| API surface | `pnpm api:snapshot:check` | Public exports match the committed snapshots. |

## Manual: the packed package in the Pi TUI

Use a Pi CLI at the version in the `pi-runtime` catalog (`pi --version`) and a throwaway Pi
directory, so the check never touches your own Pi settings.

1. Pack both packages and install them into an empty project:

   ```bash
   QA=$(mktemp -d)
   pnpm --filter @openwaggle/pi-waggle build
   (cd packages/waggle-core && pnpm pack --pack-destination "$QA/pack")
   (cd packages/pi-waggle && pnpm pack --pack-destination "$QA/pack")
   mkdir "$QA/project" && cd "$QA/project" && npm init -y
   npm install --legacy-peer-deps "$QA"/pack/openwaggle-waggle-core-*.tgz "$QA"/pack/openwaggle-pi-waggle-*.tgz
   export PI_CODING_AGENT_DIR="$QA/agent"
   pi install ./node_modules/@openwaggle/pi-waggle
   ```

2. Give the throwaway directory one model. Either sign in with `/login` once Pi starts, or point
   `$QA/agent/models.json` at any OpenAI-compatible endpoint, such as a local Ollama server
   ([Pi models](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)).

3. Start `pi --no-session` and check each step:

   - [ ] The start screen lists `extension.js` under Extensions with no extension warning.
   - [ ] Typing `/wag` completes to `/waggle` with its description.
   - [ ] `/waggle` opens the control center (title `Waggle control center — off`) listing the
     built-in presets, `Add custom preset…` and `Manage presets…`.
   - [ ] Selecting a preset and `Enable preset` prints `Waggle enabled: <preset>` and shows it in
     the status line.
   - [ ] Sending a prompt runs alternating turns, each headed `🐝 Turn N · <agent> · <model>`, and
     the status line ends with `Waggle complete` when the stop policy ends the run.
   - [ ] `/standard` prints `Waggle disabled.`

4. In OpenWaggle (`pnpm dev`), run one Waggle from the composer and check that each turn shows one
   divider and model label, with one coloured rail per agent turn.

Record the Pi version and the result in the release pull request. Screens from the last run before
a release are enough; keep them outside the repository.
