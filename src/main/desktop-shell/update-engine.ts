import { electrobunUpdateEngine } from '../adapters/electrobun/electrobun-update-engine'
import type { UpdateEngineShape } from '../ports/desktop-shell/update-engine'

/** The desktop shell's UpdateEngine (ADR 0064), bound to its Electrobun adapter. */
export const updateEngine: UpdateEngineShape = electrobunUpdateEngine
