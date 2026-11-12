import { electronChildScriptRuntime } from '../adapters/electron/electron-child-script-runtime'
import type { ChildScriptRuntimeShape } from '../ports/desktop-shell/child-runtime'

/** The desktop shell's ChildScriptRuntime (ADR 0064); the shell switch changes only this binding. */
export const childScriptRuntime: ChildScriptRuntimeShape = electronChildScriptRuntime
