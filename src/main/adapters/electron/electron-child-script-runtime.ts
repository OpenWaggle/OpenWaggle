import type { ChildScriptRuntimeShape } from '../../ports/desktop-shell/child-runtime'

/** Electron's own executable runs a script as Node when `ELECTRON_RUN_AS_NODE=1`. */
export const electronChildScriptRuntime: ChildScriptRuntimeShape = {
  executable: () => process.execPath,
  environment: (environment) => ({ ...environment, ELECTRON_RUN_AS_NODE: '1' }),
}
