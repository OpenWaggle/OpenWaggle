import { parseJsonUnknown, safeDecodeUnknown, Schema } from '@shared/schema'
import { liveProcessEnvironment } from '../../../env'

/**
 * CEF's DevTools endpoint (ADR 0064): the Chrome DevTools Protocol of the CEF browser previews,
 * served by CEF on `127.0.0.1:<port>` when the app enables `remote-debugging-port`.
 *
 * The port is chosen per launch. The app's build sets `chromiumFlags['remote-debugging-port']` to
 * `'launch'`; OpenWaggle's Electrobun launcher (vendor/electrobun patch 0006) then reserves a free
 * loopback port before CEF starts and hands it to CEF and the app through
 * `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT`. A fixed port could be taken by another app or a second
 * OpenWaggle, and is known in advance to anything that wants to squat on it. Without the launcher
 * patch CEF reads `'launch'` as an invalid port and serves no endpoint, and previews still load
 * pages, without CDP.
 *
 * The endpoint is a local TCP port. Any process of the same machine can connect to it and drive
 * every CEF page, including reading the preview profiles' cookies. Web pages cannot: Chromium
 * checks the `Host` header against DNS rebinding and refuses WebSocket upgrades that carry an
 * `Origin` unless `remote-allow-origins` allows it, so the app never sets that flag. The app takes
 * the variable out of its environment (`takeCefRemoteDebuggingPortVariable`), so no child process
 * (a terminal, an agent tool) inherits the port. This module talks only to `127.0.0.1` on that
 * port, only accepts a page target whose WebSocket URL is on the same host and port, and finds a
 * preview by a random marker in its first URL, so a process squatting on the port cannot hand it
 * a page of its own.
 */

const MIN_PORT = 1_024
const MAX_PORT = 65_535
const LOOPBACK_HOST = '127.0.0.1'
const PORT_FLAG = 'remote-debugging-port'
const CEF_REMOTE_DEBUGGING_PORT_VARIABLE = 'ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT'

/** The launcher's CEF DevTools port, removed so no child process inherits a way into previews. */
export function takeCefRemoteDebuggingPortVariable(): string | undefined {
  const environment = liveProcessEnvironment()
  const value = environment[CEF_REMOTE_DEBUGGING_PORT_VARIABLE]
  Reflect.deleteProperty(environment, CEF_REMOTE_DEBUGGING_PORT_VARIABLE)
  return value
}

const DevToolsTargetSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.optional(Schema.String),
})
const DevToolsTargetListSchema = Schema.Array(DevToolsTargetSchema)

export type CefDevToolsTarget = Schema.Schema.Type<typeof DevToolsTargetSchema>

export type CefDevToolsFetch = (url: string) => Promise<{
  readonly ok: boolean
  readonly status: number
  readonly text: () => Promise<string>
}>

function parsePort(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const port = Number(value.trim())
  return port >= MIN_PORT && port <= MAX_PORT ? port : null
}

/**
 * The DevTools port CEF listens on, as the native layer resolves it: the launch environment wins
 * over the build configuration's `chromiumFlags`. `null` when neither names a valid port; a dev
 * build's automatic port scan is not followed, because the app cannot learn which port it took.
 */
export function resolveCefRemoteDebuggingPort(input: {
  readonly environmentPort: string | undefined
  readonly chromiumFlags: Readonly<Record<string, string | boolean>> | undefined
}): number | null {
  if (input.environmentPort !== undefined) return parsePort(input.environmentPort)
  return parsePort(input.chromiumFlags?.[PORT_FLAG])
}

/** The page target's WebSocket URL, accepted only on the endpoint's own loopback host and port. */
export function cefDevToolsSocketUrl(port: number, target: CefDevToolsTarget): string {
  const raw = target.webSocketDebuggerUrl
  if (raw === undefined) throw new Error('The CEF DevTools target has no WebSocket URL.')
  const url = new URL(raw)
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== LOOPBACK_HOST ||
    url.port !== String(port) ||
    url.pathname !== `/devtools/page/${target.id}`
  ) {
    throw new Error('The CEF DevTools target points outside this app’s DevTools endpoint.')
  }
  return url.href
}

export class CefDevToolsEndpoint {
  readonly port: number
  private readonly fetchTargets: CefDevToolsFetch

  constructor(port: number, fetchTargets: CefDevToolsFetch) {
    this.port = port
    this.fetchTargets = fetchTargets
  }

  async listTargets(): Promise<readonly CefDevToolsTarget[]> {
    const response = await this.fetchTargets(
      `http://${LOOPBACK_HOST}:${String(this.port)}/json/list`,
    )
    if (!response.ok) {
      throw new Error(`The CEF DevTools target list failed with HTTP ${String(response.status)}.`)
    }
    const decoded = safeDecodeUnknown(
      DevToolsTargetListSchema,
      parseJsonUnknown(await response.text()),
    )
    if (!decoded.success) throw new Error('The CEF DevTools target list is malformed.')
    return decoded.data
  }

  /** Polls the target list until the page whose URL carries `marker` appears. */
  async waitForPage(
    marker: string,
    options: { readonly deadlineMs: number; readonly pollMs: number; readonly signal: AbortSignal },
  ): Promise<CefDevToolsTarget> {
    const deadline = Date.now() + options.deadlineMs
    let lastError: unknown = null
    while (Date.now() < deadline) {
      if (options.signal.aborted) throw new Error('The browser preview closed before CDP attached.')
      try {
        const page = (await this.listTargets()).find(
          (target) => target.type === 'page' && target.url.includes(marker),
        )
        if (page !== undefined) return page
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs))
    }
    throw new Error(
      `The browser preview never appeared on the CEF DevTools endpoint 127.0.0.1:${String(this.port)}.`,
      { cause: lastError },
    )
  }
}
