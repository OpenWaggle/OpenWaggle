import { electronAppPaths } from '../adapters/electron/electron-app-paths'
import type { AppPathsShape } from '../ports/desktop-shell/app-paths'

/** The desktop shell's AppPaths (ADR 0064); the shell switch changes only this binding. */
export const appPaths: AppPathsShape = electronAppPaths
