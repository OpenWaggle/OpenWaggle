import { match } from '@diegogbrisa/ts-match'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type {
  BrowserPreviewAutomationConsoleEntry,
  BrowserPreviewAutomationNetworkEntry,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'

const MAX_DIAGNOSTIC_TEXT_LENGTH = 4_096
const MAX_DIAGNOSTIC_URL_LENGTH = 8_192
const MAX_DIAGNOSTIC_METHOD_LENGTH = 64
const EPOCH_TIMESTAMP_THRESHOLD = 10_000_000_000
const MILLISECONDS_PER_SECOND = 1_000
const PENDING_REQUEST_TTL_MS = 30_000

const consoleMessageSchema = Schema.Struct({
  type: Schema.String,
  args: Schema.Array(
    Schema.Struct({
      value: Schema.optional(Schema.Unknown),
      description: Schema.optional(Schema.String),
    }),
  ),
  timestamp: Schema.Number,
})

const logEntrySchema = Schema.Struct({
  entry: Schema.Struct({
    level: Schema.String,
    text: Schema.String,
    timestamp: Schema.Number,
    url: Schema.optional(Schema.String),
  }),
})

const requestSchema = Schema.Struct({
  requestId: Schema.String,
  request: Schema.Struct({ url: Schema.String, method: Schema.String }),
  wallTime: Schema.optional(Schema.Number),
})

const responseSchema = Schema.Struct({
  requestId: Schema.String,
  response: Schema.Struct({ url: Schema.String, status: Schema.Number }),
})

const failureSchema = Schema.Struct({
  requestId: Schema.String,
  errorText: Schema.String,
})

interface PendingRequest {
  readonly url: string
  readonly method: string
  readonly timestamp: string
  readonly observedAt: number
}

export interface BrowserPreviewAutomationDiagnosticsState {
  readonly consoleEntries: BrowserPreviewAutomationConsoleEntry[]
  readonly networkEntries: BrowserPreviewAutomationNetworkEntry[]
  readonly pendingRequests: Map<string, PendingRequest>
}

export function createBrowserPreviewAutomationDiagnosticsState(): BrowserPreviewAutomationDiagnosticsState {
  return { consoleEntries: [], networkEntries: [], pendingRequests: new Map() }
}

function timestamp(value: number) {
  const milliseconds = value > EPOCH_TIMESTAMP_THRESHOLD ? value : value * MILLISECONDS_PER_SECOND
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date(Date.now()).toISOString() : date.toISOString()
}

function networkTimestamp(wallTime: number | undefined, receivedAt: number) {
  if (wallTime === undefined) return new Date(receivedAt).toISOString()
  const date = new Date(wallTime * MILLISECONDS_PER_SECOND)
  return Number.isNaN(date.getTime()) ? new Date(receivedAt).toISOString() : date.toISOString()
}

function boundedText(value: string, maxLength = MAX_DIAGNOSTIC_TEXT_LENGTH) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

function remoteValueText(value: unknown, description?: string) {
  if (value === undefined) return description ?? 'undefined'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? description ?? String(value)
  } catch {
    return description ?? String(value)
  }
}

function appendBounded<T>(values: T[], value: T, maximum: number) {
  values.push(value)
  if (values.length > maximum) values.splice(0, values.length - maximum)
}

function recordConsole(state: BrowserPreviewAutomationDiagnosticsState, params: unknown) {
  const decoded = safeDecodeUnknown(consoleMessageSchema, params)
  if (!decoded.success) return
  const text = decoded.data.args
    .map((argument) => remoteValueText(argument.value, argument.description))
    .join(' ')
  appendBounded(
    state.consoleEntries,
    {
      level: decoded.data.type,
      text: boundedText(text),
      timestamp: timestamp(decoded.data.timestamp),
    },
    BROWSER_PREVIEW_AUTOMATION_LIMITS.CONSOLE_ENTRIES,
  )
}

function recordLogEntry(state: BrowserPreviewAutomationDiagnosticsState, params: unknown) {
  const decoded = safeDecodeUnknown(logEntrySchema, params)
  if (!decoded.success) return
  appendBounded(
    state.consoleEntries,
    {
      level: decoded.data.entry.level,
      text: boundedText(decoded.data.entry.text),
      timestamp: timestamp(decoded.data.entry.timestamp),
      ...(decoded.data.entry.url ? { source: boundedText(decoded.data.entry.url) } : {}),
    },
    BROWSER_PREVIEW_AUTOMATION_LIMITS.CONSOLE_ENTRIES,
  )
}

function recordRequest(state: BrowserPreviewAutomationDiagnosticsState, params: unknown) {
  const decoded = safeDecodeUnknown(requestSchema, params)
  if (!decoded.success) return
  const observedAt = Date.now()
  state.pendingRequests.delete(decoded.data.requestId)
  const expiration = observedAt - PENDING_REQUEST_TTL_MS
  for (const [requestId, request] of state.pendingRequests) {
    if (
      request.observedAt >= expiration &&
      state.pendingRequests.size < BROWSER_PREVIEW_AUTOMATION_LIMITS.NETWORK_ENTRIES
    ) {
      break
    }
    state.pendingRequests.delete(requestId)
  }
  state.pendingRequests.set(decoded.data.requestId, {
    url: boundedText(decoded.data.request.url, MAX_DIAGNOSTIC_URL_LENGTH),
    method: boundedText(decoded.data.request.method, MAX_DIAGNOSTIC_METHOD_LENGTH),
    timestamp: networkTimestamp(decoded.data.wallTime, observedAt),
    observedAt,
  })
}

export function clearBrowserPreviewPendingDiagnostics(
  state: BrowserPreviewAutomationDiagnosticsState,
) {
  state.pendingRequests.clear()
}

function appendNetwork(
  state: BrowserPreviewAutomationDiagnosticsState,
  entry: BrowserPreviewAutomationNetworkEntry,
) {
  appendBounded(state.networkEntries, entry, BROWSER_PREVIEW_AUTOMATION_LIMITS.NETWORK_ENTRIES)
}

function recordResponse(state: BrowserPreviewAutomationDiagnosticsState, params: unknown) {
  const decoded = safeDecodeUnknown(responseSchema, params)
  if (!decoded.success) return
  const receivedAt = Date.now()
  const request = state.pendingRequests.get(decoded.data.requestId)
  state.pendingRequests.delete(decoded.data.requestId)
  appendNetwork(state, {
    url: boundedText(decoded.data.response.url, MAX_DIAGNOSTIC_URL_LENGTH),
    method: request?.method ?? 'GET',
    status: decoded.data.response.status,
    failed: false,
    timestamp: request?.timestamp ?? networkTimestamp(undefined, receivedAt),
  })
}

function recordFailure(state: BrowserPreviewAutomationDiagnosticsState, params: unknown) {
  const decoded = safeDecodeUnknown(failureSchema, params)
  if (!decoded.success) return
  const receivedAt = Date.now()
  const request = state.pendingRequests.get(decoded.data.requestId)
  state.pendingRequests.delete(decoded.data.requestId)
  appendNetwork(state, {
    url: request?.url ?? '',
    method: request?.method ?? 'GET',
    status: null,
    failed: true,
    errorText: boundedText(decoded.data.errorText),
    timestamp: request?.timestamp ?? networkTimestamp(undefined, receivedAt),
  })
}

export function recordBrowserPreviewCdpMessage(
  state: BrowserPreviewAutomationDiagnosticsState,
  method: string,
  params: unknown,
) {
  match(method)
    .with('Runtime.consoleAPICalled', () => recordConsole(state, params))
    .with('Log.entryAdded', () => recordLogEntry(state, params))
    .with('Network.requestWillBeSent', () => recordRequest(state, params))
    .with('Network.responseReceived', () => recordResponse(state, params))
    .with('Network.loadingFailed', () => recordFailure(state, params))
    .otherwise(() => undefined)
}
