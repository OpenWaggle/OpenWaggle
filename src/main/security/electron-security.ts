import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { Session, WebPreferences } from 'electron'

const SECURITY_PREFERENCE_EXPECTATIONS = [
  { key: 'nodeIntegration', expected: false },
  { key: 'contextIsolation', expected: true },
  { key: 'sandbox', expected: true },
  { key: 'webSecurity', expected: true },
  { key: 'allowRunningInsecureContent', expected: false },
] as const

const DIRECTIVE_SEPARATOR = '; '
const VALUE_SEPARATOR = ' '
// Vite React injects a deterministic inline preamble script in dev.
// Allow only that exact script hash so dev boot works without enabling broad unsafe-inline.
const VITE_REACT_PREAMBLE_HASH = "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='" as const
const EXTENSION_RUNTIME_SCRIPT_SOURCE =
  `${OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME}:` as const
const SCRIPT_SRC_VALUES = [
  "'self'",
  VITE_REACT_PREAMBLE_HASH,
  EXTENSION_RUNTIME_SCRIPT_SOURCE,
] as const
const STYLE_SRC_VALUES = ["'self'", "'unsafe-inline'"] as const
const IMG_SRC_VALUES = ["'self'", 'data:'] as const
const EXTENSION_FRAME_SOURCE = `${OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME}:` as const
const FRAME_SRC_VALUES = ["'self'", EXTENSION_FRAME_SOURCE] as const
const CONNECT_SRC_VALUES = [
  "'self'",
  'ws://localhost:*',
  'http://localhost:*',
  'https://localhost:*',
  'wss://localhost:*',
  'https://api.github.com',
] as const

const CSP_DIRECTIVES = [
  ['default-src', ["'self'"]],
  ['script-src', SCRIPT_SRC_VALUES],
  ['script-src-elem', SCRIPT_SRC_VALUES],
  ['style-src', STYLE_SRC_VALUES],
  ['img-src', IMG_SRC_VALUES],
  ['frame-src', FRAME_SRC_VALUES],
  ['connect-src', CONNECT_SRC_VALUES],
] as const

type CspResponseHeaders = Record<string, string[] | string>

export const SECURE_WEB_PREFERENCES: Readonly<
  Pick<
    WebPreferences,
    | 'nodeIntegration'
    | 'contextIsolation'
    | 'sandbox'
    | 'webSecurity'
    | 'allowRunningInsecureContent'
  >
> = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
}

type SessionWithHeadersHandler = {
  webRequest: Pick<Session['webRequest'], 'onHeadersReceived'>
}

const sessionCspInstallState = new WeakSet<SessionWithHeadersHandler>()

export function buildContentSecurityPolicy(): string {
  return CSP_DIRECTIVES.map(([name, values]) => `${name} ${values.join(VALUE_SEPARATOR)}`).join(
    DIRECTIVE_SEPARATOR,
  )
}

export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy()

export function applyContentSecurityPolicyHeader(
  responseHeaders: CspResponseHeaders | undefined,
): CspResponseHeaders {
  return {
    ...(responseHeaders ?? {}),
    'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
  }
}

function isExtensionFrameProtocolUrl(url: string) {
  try {
    return new URL(url).protocol === `${OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME}:`
  } catch {
    return false
  }
}

export function assertSecureWebPreferences(preferences: WebPreferences): void {
  for (const expectation of SECURITY_PREFERENCE_EXPECTATIONS) {
    const actualValue = preferences[expectation.key]
    if (actualValue !== expectation.expected) {
      throw new Error(
        `Insecure BrowserWindow webPreferences: "${expectation.key}" must be ${String(expectation.expected)}, received ${String(actualValue)}.`,
      )
    }
  }
}

export function installCspHeaders(session: SessionWithHeadersHandler): void {
  if (sessionCspInstallState.has(session)) {
    return
  }

  session.webRequest.onHeadersReceived((details, callback) => {
    if (isExtensionFrameProtocolUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: applyContentSecurityPolicyHeader(details.responseHeaders),
    })
  })
  sessionCspInstallState.add(session)
}
