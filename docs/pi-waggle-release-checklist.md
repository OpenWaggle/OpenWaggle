# Pi Waggle release checklist

Run this before a release of `@openwaggle/pi-waggle` or `@openwaggle/waggle-core`, and after a Pi
upgrade. The automated part runs in CI on every pull request. The manual part loads the packed
package in the real Pi TUI, which no automated check does.

## Automated (CI)

| Check | Command | What it proves |
|---|---|---|
| Package tests | `pnpm test:unit` | `packages/waggle-core` policy and `packages/pi-waggle` behaviour against a fake Pi `ExtensionAPI`. Policy covers config, presets, turn sequencing and the stop policy. The Pi side covers command parsing, mode state, preset storage, inherited models, model switching, turn markers and renderers. |
| Desktop adapter | `pnpm test:unit` and `pnpm test:integration` | OpenWaggle runs Waggle through `@openwaggle/pi-waggle/loop` and projects mode state, turn identity and retries into the Session read model. See `waggle-run-service.unit`, `session-waggle-mode-state.integration`, `waggle-turn-identity-projection.integration` and `pi-waggle-turn-retry.integration`. |
| Tarball consumers | `pnpm package:smoke`, part of `pnpm check` | The packed tarballs install with npm, pnpm, Yarn and Bun. Every export resolves in ESM and CommonJS, and a CommonJS Waggle turn settles. Pi's own resource loader loads the installed package as a package source, with no errors or warnings, and the declared entry, `dist/extension.js`, registers `/waggle`, `/standard` and the turn renderer. Pi's host packages, the Pi SDKs and `typebox`, must be `"*"` peer dependencies. |
| Desktop bundle | `pnpm pi-main-bundle:smoke`, part of `pnpm check` | The Electron main build bundles `@openwaggle/pi-waggle` from its sources. In a real Pi session under Node and under Electron, the smoke loads `src/extension.ts`, the module the declared entry is built from, and checks that `/waggle`, `/standard` and the turn renderer register and that mode state round-trips. It also binds the desktop Waggle loop and stops it. |
| Dead code | `pnpm check:waggle-dead-code`, part of `pnpm check` | No production-unused code in the Waggle packages, the app files that import them or are named for Waggle, and the desktop agent policy modules. Code that only tests use counts as unused. |
| API surface | `pnpm api:snapshot:check` | Public exports match the committed snapshots. |

## Manual: the packed package in the Pi TUI

Use a stock Pi CLI at the version in the `pi-runtime` catalog, not `node_modules/.bin/pi`, which
has OpenWaggle's patches applied. Install it with Pi's installer, or with
`npm install -g --ignore-scripts @earendil-works/pi-coding-agent@<version>`, and check
`pi --version`. Use a throwaway Pi directory so the check never touches your own Pi settings.

1. Pack both packages and install them into an empty project. `--legacy-peer-deps` leaves the
   Pi peers uninstalled, as Pi does when it installs a package, so the CLI supplies them:

   ```bash
   QA=$(mktemp -d)
   pnpm --filter @openwaggle/pi-waggle build
   (cd packages/waggle-core && pnpm pack --pack-destination "$QA/pack")
   (cd packages/pi-waggle && pnpm pack --pack-destination "$QA/pack")
   mkdir "$QA/project"
   (
     cd "$QA/project"
     npm init -y
     npm install --legacy-peer-deps "$QA"/pack/openwaggle-waggle-core-*.tgz "$QA"/pack/openwaggle-pi-waggle-*.tgz
     PI_CODING_AGENT_DIR="$QA/agent" pi install ./node_modules/@openwaggle/pi-waggle
   )
   ```

2. Give the throwaway directory one model. Either sign in with `/login` once Pi starts, or point
   `$QA/agent/models.json` at any OpenAI-compatible endpoint, such as a local Ollama server. See
   [Pi models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).

3. Start Pi with `cd "$QA/project" && PI_CODING_AGENT_DIR="$QA/agent" pi --no-session` in a
   second terminal, and check each step:

   - [ ] The start screen lists `extension.js` under Extensions with no extension warning.
   - [ ] Typing `/wag` completes to `/waggle` with its description.
   - [ ] `/waggle` opens the control center, titled `Waggle control center — off`, listing the
     built-in presets, `Add custom preset…` and `Manage presets…`.
   - [ ] Selecting a preset and `Enable preset` prints `Waggle enabled: <preset>` and shows it in
     the status line.
   - [ ] Sending a prompt runs alternating turns, each headed `🐝 Turn N · <agent> · <model>`, and
     the status line ends with `Waggle complete` when the stop policy ends the run.
   - [ ] `/standard` prints `Waggle disabled.`

4. Build the packaged app for your platform, for example with `pnpm build:unpack`, because the app
   bundles pi-waggle and dev mode does not prove the packaged bundle works. Start the packaged app,
   run one Waggle from the composer, and check that each turn shows one divider and model label,
   with one coloured rail per agent turn.

Record the Pi version and the result in the release pull request. Screenshots from the last run
before a release are enough; keep them outside the repository.
