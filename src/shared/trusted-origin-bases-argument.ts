/**
 * The trusted origins the renderer addresses by URLs it builds itself (ADR 0064). Where a trusted
 * origin lives depends on the desktop shell: Electron serves `<scheme>://<host>`, Electrobun a
 * loopback server with a capability path (`TrustedOriginsShape.originOf`). The main process passes
 * each base as a renderer argument when it creates the window, and the preload exposes them as
 * `window.api.getTrustedOriginBases()`, the way the home directory reaches the page.
 */
export interface RendererTrustedOriginBases {
  /** Where the renderer and extension frames import extension UI modules from, no trailing slash. */
  readonly extensionRuntime: string
}

const EXTENSION_RUNTIME_BASE_SWITCH = '--openwaggle-extension-runtime-base='

/** The renderer arguments that carry `bases`. */
export function trustedOriginBasesRendererArguments(
  bases: RendererTrustedOriginBases,
): readonly string[] {
  return [`${EXTENSION_RUNTIME_BASE_SWITCH}${bases.extensionRuntime}`]
}

function isAbsoluteUrl(value: string) {
  try {
    return new URL(value).protocol.length > 0
  } catch {
    return false
  }
}

/** The bases main passed in a renderer's arguments, or null when one is missing or no URL. */
export function trustedOriginBasesFromRendererArguments(
  argv: readonly string[],
): RendererTrustedOriginBases | null {
  const argument = argv.find((entry) => entry.startsWith(EXTENSION_RUNTIME_BASE_SWITCH))
  const extensionRuntime = argument?.slice(EXTENSION_RUNTIME_BASE_SWITCH.length) ?? ''
  return isAbsoluteUrl(extensionRuntime) ? { extensionRuntime } : null
}
