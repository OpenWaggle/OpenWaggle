import { electrobunChildScriptRuntime } from '../adapters/electrobun/electrobun-child-script-runtime'
import type { ChildScriptRuntimeShape } from '../ports/desktop-shell/child-runtime'

/** The desktop shell's ChildScriptRuntime (ADR 0064), bound to its Electrobun adapter. */
export const childScriptRuntime: ChildScriptRuntimeShape = electrobunChildScriptRuntime
