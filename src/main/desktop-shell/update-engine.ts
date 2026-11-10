import { electronUpdateEngine } from '../adapters/electron/electron-update-engine'
import type { UpdateEngineShape } from '../ports/desktop-shell/update-engine'

/** The desktop shell's UpdateEngine (ADR 0064); the shell switch changes only this binding. */
export const updateEngine: UpdateEngineShape = electronUpdateEngine
