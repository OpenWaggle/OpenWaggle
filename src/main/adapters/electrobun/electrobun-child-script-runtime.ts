import type { ChildScriptRuntimeShape } from '../../ports/desktop-shell/child-runtime'

/**
 * Electron's switch to make its executable run a script. Bun runs a script as is, so a child must
 * never inherit it from an Electron parent (an Electron install updating to this build).
 */
const ELECTRON_SCRIPT_SWITCH = 'ELECTRON_RUN_AS_NODE'

/** Electrobun's `process.execPath` is the bundled Bun, which runs `<script>` and `-e` directly. */
export const electrobunChildScriptRuntime: ChildScriptRuntimeShape = {
  executable: () => process.execPath,
  environment: (environment) => {
    const child = { ...environment }
    delete child[ELECTRON_SCRIPT_SWITCH]
    return child
  },
}
