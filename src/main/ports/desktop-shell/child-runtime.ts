import { Context } from 'effect'

type ChildEnvironment = Readonly<Record<string, string | undefined>>

/**
 * How OpenWaggle runs one of its own JavaScript entry points (or `-e` source) as a plain script
 * child: the Session Host's helpers, CLI shim and session-export installers, the embedding
 * process, pinned-directory creation and the bound credential and agent-definition mutations.
 *
 * The shell's own executable is the script runtime, so packaged builds need no separate Node.
 * The Electron adapter sets `ELECTRON_RUN_AS_NODE=1` for that.
 */
export interface ChildScriptRuntimeShape {
  /** The executable to spawn; arguments are the script (or `-e`, source) and its arguments. */
  readonly executable: () => string
  /** `environment` plus whatever makes `executable()` run a script instead of the app. */
  readonly environment: (environment: ChildEnvironment) => Record<string, string | undefined>
}

export class ChildScriptRuntime extends Context.Tag('@openwaggle/ChildScriptRuntime')<
  ChildScriptRuntime,
  ChildScriptRuntimeShape
>() {}
