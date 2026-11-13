import { electrobunBrowserEngine } from '../adapters/electrobun/electrobun-browser-engine'
import type { BrowserEngineShape } from '../ports/desktop-shell/browser-engine'

/** The desktop shell's BrowserEngine (ADR 0064); the shell switch changes only this binding. */
export const browserEngine: BrowserEngineShape = electrobunBrowserEngine
