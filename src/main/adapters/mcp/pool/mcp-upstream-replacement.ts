import type { Pending } from './mcp-connection-support'
import { JSON_RPC_ERROR_CODES, type JsonRpcErrorResponse, toError } from './mcp-wire'

type LeasePending = Extract<Pending, { readonly kind: 'lease' }>

/**
 * Listings a client asks for when it connects. They change nothing on the server, so one that a
 * stuck server process fails can be asked again of a fresh process; a tool call is never resent.
 */
const RELISTED_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
])

/** A connection replaces its server process at most this often; one failing faster stays failed. */
export const UPSTREAM_REPLACEMENT_INTERVAL_MS = 60_000

/** What replacing the server process of one pooled connection needs from it. */
export interface McpUpstreamReplacementHost {
  /** Closed or retiring. */
  readonly isClosed: () => boolean
  /**
   * Whether anything still waits on the current process: a request of a client's or OpenWaggle's,
   * or one of the server's own requests, whose answer would otherwise reach the fresh process.
   */
  readonly hasPending: () => boolean
  /** Closes the current process, then opens and initializes another in its place. */
  readonly replaceUpstream: () => Promise<void>
  /** Sends a client's request again, on the current process. */
  readonly resend: (pending: LeasePending) => Promise<void>
  /** Takes no new client and closes once its open requests settle; nothing once closed. */
  readonly retire: () => void
}

/**
 * Recovers a pooled connection whose server process got stuck. A stdio proxy whose own HTTP
 * connection broke (Datadog's `datadog_mcp_cli`) answers every request with "Internal error" from
 * then on, and a warm connection would hand that process to every later Run, each warning that
 * the server "needs attention". A listing failing so is asked again of a fresh process, so the
 * client never sees it.
 */
export class McpUpstreamReplacement {
  private replacing: Promise<void> | undefined
  private lastReplacementAt: number | undefined

  constructor(
    private readonly host: McpUpstreamReplacementHost,
    private readonly now: () => number = Date.now,
  ) {}

  /** Resolves once a replacement in progress is done, whatever its outcome. */
  settled() {
    return this.replacing?.catch(() => undefined)
  }

  /**
   * Handles a client's request that the server answered with an error; `false` leaves the error
   * to be delivered. A failed listing is sent again on a fresh process only when nothing else is
   * open on the old one (its requests would be lost) and it was not replaced in the last minute;
   * otherwise the client gets the error and the connection retires, so the next Run starts its
   * own process.
   */
  handleError(pending: LeasePending, failed: JsonRpcErrorResponse) {
    if (!RELISTED_METHODS.has(pending.method)) return false
    if (failed.error.code !== JSON_RPC_ERROR_CODES.internalError) return false
    const now = this.now()
    const recently =
      this.lastReplacementAt !== undefined &&
      now - this.lastReplacementAt < UPSTREAM_REPLACEMENT_INTERVAL_MS
    /** `replacementError` names why a fresh process did not help, next to the server's error. */
    const giveUp = (replacementError?: unknown) => {
      const message =
        replacementError === undefined
          ? failed.error.message
          : `${failed.error.message} (a fresh server process failed too: ${toError(replacementError).message})`
      pending.lease.deliver({ ...failed, id: pending.id, error: { ...failed.error, message } })
      this.host.retire()
    }
    if (this.host.isClosed() || this.replacing || recently || this.host.hasPending()) {
      giveUp()
      return true
    }
    this.lastReplacementAt = now
    const replacing = this.host.replaceUpstream()
    this.replacing = replacing
    void replacing
      .then(() => (pending.lease.isDetached ? undefined : this.host.resend(pending)))
      // A fresh process that cannot start has closed the connection already. One that starts but
      // fails its `initialize`, or the listing sent again, must not serve the next Run either.
      .catch((error: unknown) => giveUp(error))
      .finally(() => {
        if (this.replacing === replacing) this.replacing = undefined
      })
    return true
  }
}
