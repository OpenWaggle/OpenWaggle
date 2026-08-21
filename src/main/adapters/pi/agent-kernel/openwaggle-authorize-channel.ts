import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'

/**
 * How OpenWaggle's own adapter code reaches the authorization path.
 *
 * Pi's `ui.confirm(title, message, opts)` has nowhere to carry a declared purpose or a grant key, so
 * rather than smuggle either through the wording or through `opts`, OpenWaggle attaches its own
 * method to the UI context it builds. Anything that calls plain `confirm` is therefore asking the
 * user a question, which is the safe default: no access mode may answer it.
 *
 * Keyed by a registered symbol so it cannot collide with a Pi property and so a UI context that is
 * not OpenWaggle's simply lacks it, in which case callers fall back to prompting.
 */
export const OPENWAGGLE_AUTHORIZE_KEY = Symbol.for('openwaggle.ui.authorize')

export interface OpenWaggleAuthorizeRequest {
  readonly title: string
  readonly message: string
  readonly scopeKey: AgentAuthorizationScopeKey
  readonly signal?: AbortSignal
}

export type OpenWaggleAuthorize = (request: OpenWaggleAuthorizeRequest) => Promise<boolean>

/**
 * Reads the authorization method off a UI context, when it is OpenWaggle's.
 *
 * Callers must fall back to a plain confirm when this returns `undefined`, so a missing channel
 * degrades to always asking rather than to always allowing.
 */
interface OpenWaggleAuthorizeCarrier {
  readonly [OPENWAGGLE_AUTHORIZE_KEY]: OpenWaggleAuthorize
}

function carriesAuthorize(ui: object): ui is OpenWaggleAuthorizeCarrier {
  return (
    OPENWAGGLE_AUTHORIZE_KEY in ui &&
    typeof Reflect.get(ui, OPENWAGGLE_AUTHORIZE_KEY) === 'function'
  )
}

export function getOpenWaggleAuthorize(ui: unknown): OpenWaggleAuthorize | undefined {
  if (typeof ui !== 'object' || ui === null) return undefined
  return carriesAuthorize(ui) ? ui[OPENWAGGLE_AUTHORIZE_KEY] : undefined
}
