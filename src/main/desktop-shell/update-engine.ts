import { electronUpdateEngine } from '../adapters/electron/electron-update-engine'
import type { UpdateEngineShape } from '../ports/desktop-shell/update-engine'

/** The desktop shell's UpdateEngine (ADR 0064), bound to its Electron adapter. */
export const updateEngine: UpdateEngineShape = electronUpdateEngine
