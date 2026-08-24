import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type { AgentLoopConfirmPurpose } from '@shared/types/agent-loop-interaction'

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
 * How OpenWaggle's adapter code declares a NON-authorization purpose on a confirmation.
 *
 * Plain `ui.confirm` is deliberately `user-input`, the purpose nothing may answer on the user's
 * behalf, so an unlabelled request always prompts. Two of our own confirmations are more specific
 * than that: one opens a URL at a destination a third party chose, and one discloses which server
 * wants the user's data. `CONTEXT.md` states that neither is ever answered automatically in any
 * access mode, and that rule can only be checked if the requests actually carry those purposes.
 *
 * Separate from the authorization channel on purpose. `purpose` here excludes `authorization`, so
 * this seam cannot raise a request an access mode is allowed to auto-answer, and it carries no grant
 * key because there is nothing to keep.
 */
export const OPENWAGGLE_DECLARED_CONFIRM_KEY = Symbol.for('openwaggle.ui.declaredConfirm')

export type OpenWaggleDeclaredConfirmPurpose = Exclude<AgentLoopConfirmPurpose, 'authorization'>

export interface OpenWaggleDeclaredConfirmRequest {
  readonly title: string
  readonly message: string
  readonly purpose: OpenWaggleDeclaredConfirmPurpose
  readonly signal?: AbortSignal
}

export type OpenWaggleDeclaredConfirm = (
  request: OpenWaggleDeclaredConfirmRequest,
) => Promise<boolean>

interface OpenWaggleDeclaredConfirmCarrier {
  readonly [OPENWAGGLE_DECLARED_CONFIRM_KEY]: OpenWaggleDeclaredConfirm
}

function carriesDeclaredConfirm(ui: object): ui is OpenWaggleDeclaredConfirmCarrier {
  return (
    OPENWAGGLE_DECLARED_CONFIRM_KEY in ui &&
    typeof Reflect.get(ui, OPENWAGGLE_DECLARED_CONFIRM_KEY) === 'function'
  )
}

/**
 * Reads the declared-purpose confirmation method off a UI context, when it is OpenWaggle's.
 *
 * A missing channel degrades to plain `confirm`, which is `user-input` and still always prompts, so
 * the behaviour is unchanged and only the declared category is lost.
 */
export function getOpenWaggleDeclaredConfirm(ui: unknown): OpenWaggleDeclaredConfirm | undefined {
  if (typeof ui !== 'object' || ui === null) return undefined
  return carriesDeclaredConfirm(ui) ? ui[OPENWAGGLE_DECLARED_CONFIRM_KEY] : undefined
}

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
