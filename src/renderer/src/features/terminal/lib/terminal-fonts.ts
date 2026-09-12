import symbolsNerdFontLicense from '../assets/fonts/LICENSE?raw'
import symbolsNerdFontUrl from '../assets/fonts/SymbolsNerdFontMono-Regular.woff2?url'

export const TERMINAL_SYMBOL_FONT_FAMILY = 'Symbols Nerd Font Mono'

const TERMINAL_SYMBOL_FALLBACKS = [
  `"${TERMINAL_SYMBOL_FONT_FAMILY}"`,
  '"Symbols Nerd Font"',
  '"JetBrainsMono Nerd Font"',
  '"JetBrainsMono NF"',
  '"FiraCode Nerd Font"',
  '"Hack Nerd Font"',
  '"MesloLGS NF"',
  '"CaskaydiaCove Nerd Font"',
  '"PowerlineSymbols"',
  'monospace',
] as const

export const TERMINAL_SYMBOL_FONT_ATTRIBUTION = {
  license: 'MIT',
  licenseNotice: symbolsNerdFontLicense,
  sha256: 'a8e2fc5ae3c2525812151b95da80c5beab0befa84aca84fc33aaed94317502df',
  upstream:
    'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/NerdFontsSymbolsOnly.zip',
  version: '3.4.0',
} as const

export interface TerminalSymbolsFontLoadResult {
  readonly attribution: typeof TERMINAL_SYMBOL_FONT_ATTRIBUTION
  readonly status: 'bundled' | 'local-fallback-only'
}

interface LoadableFontFace<TFace> {
  load(): Promise<TFace>
}

interface TerminalSymbolsFontEnvironment<TFace extends LoadableFontFace<TFace>> {
  readonly createFace: (family: string, source: string) => TFace
  readonly addFace: (face: TFace) => void
  readonly removeFace?: (face: TFace) => void
}

/**
 * Appends symbol-only faces after the requested text stack. CSS font fallback
 * therefore keeps every user-selected text glyph and consults Nerd Fonts only
 * for private-use prompt symbols the selected faces do not provide.
 */
export function terminalFontFamilyWithSymbols(requestedFontFamily: string) {
  const requested = requestedFontFamily.trim()
  return [...(requested.length > 0 ? [requested] : []), ...TERMINAL_SYMBOL_FALLBACKS].join(', ')
}

/** Creates a once-per-page loader while keeping the browser boundary testable. */
export function createTerminalSymbolsFontLoader<TFace extends LoadableFontFace<TFace>>(
  environment: TerminalSymbolsFontEnvironment<TFace>,
) {
  let load: Promise<TerminalSymbolsFontLoadResult> | null = null
  return () => {
    load ??= (async () => {
      let face: TFace | null = null
      try {
        face = environment.createFace(TERMINAL_SYMBOL_FONT_FAMILY, `url(${symbolsNerdFontUrl})`)
        // Register before loading so `document.fonts` emits its normal
        // loading/loadingdone lifecycle. The existing appearance observer then
        // refits xterm after the fallback face becomes usable.
        environment.addFace(face)
        await face.load()
        return { attribution: TERMINAL_SYMBOL_FONT_ATTRIBUTION, status: 'bundled' }
      } catch {
        if (face !== null) environment.removeFace?.(face)
        // Local Nerd Font and Powerline faces remain in the fallback stack.
        return {
          attribution: TERMINAL_SYMBOL_FONT_ATTRIBUTION,
          status: 'local-fallback-only',
        }
      }
    })()
    return load
  }
}

let browserLoad: Promise<TerminalSymbolsFontLoadResult> | null = null

/** Lazily registers the bundled symbols-only face on the first terminal. */
export function ensureTerminalSymbolsFont(): Promise<TerminalSymbolsFontLoadResult> {
  browserLoad ??= (async () => {
    if (typeof FontFace !== 'function' || typeof document === 'undefined') {
      return {
        attribution: TERMINAL_SYMBOL_FONT_ATTRIBUTION,
        status: 'local-fallback-only',
      }
    }
    const load = createTerminalSymbolsFontLoader({
      createFace: (family, source) => new FontFace(family, source),
      addFace: (face) => document.fonts.add(face),
      removeFace: (face) => document.fonts.delete(face),
    })
    return load()
  })()
  return browserLoad
}
