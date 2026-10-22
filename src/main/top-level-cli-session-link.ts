import {
  hasSessionLinkScheme,
  parseSessionLink,
  SESSION_LINK_FORMAT_HINT,
} from '@shared/utils/session-link'

export type SessionLinkLaunchRoute =
  | { readonly kind: 'open-session-link'; readonly link: string }
  | { readonly kind: 'usage-error'; readonly message: string }

/**
 * A Session link given to the executable, as Windows and Linux open one (ADR 0056), or `null`
 * when the first argument is not an `openwaggle:` URL. Any other `openwaggle:` value is refused
 * here, so it never reaches the desktop app or raises a window.
 */
export function routeSessionLinkLaunch(argv: readonly string[]): SessionLinkLaunchRoute | null {
  const [first] = argv
  if (first === undefined || !hasSessionLinkScheme(first)) return null
  if (argv.length > 1) {
    return {
      kind: 'usage-error',
      message: `unexpected argument '${argv[1] ?? ''}' after a Session link.`,
    }
  }
  if (parseSessionLink(first) === null) {
    return { kind: 'usage-error', message: `not a Session link. ${SESSION_LINK_FORMAT_HINT}` }
  }
  return { kind: 'open-session-link', link: first.trim() }
}
