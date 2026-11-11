import { electrobunAppPaths } from '../adapters/electrobun/electrobun-app-paths'
import type { AppPathsShape } from '../ports/desktop-shell/app-paths'

/** The desktop shell's AppPaths (ADR 0064), bound to its Electrobun adapter. */
export const appPaths: AppPathsShape = electrobunAppPaths
