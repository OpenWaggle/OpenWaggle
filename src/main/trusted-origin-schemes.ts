import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { INLINE_VISUALIZATION_PROTOCOL } from '@shared/constants/inline-visualization'
import { MCP_APP_FRAME_PROTOCOL } from '@shared/constants/mcp-app-frame'
import { SESSION_RESOURCE_PROTOCOL } from '@shared/constants/session-resource-protocol'
import type { TrustedOriginDomain } from './ports/desktop-shell/trusted-origins'

/** The URL scheme of each trusted origin domain, as pages and the renderer address them. */
export const TRUSTED_ORIGIN_SCHEMES: Readonly<Record<TrustedOriginDomain, string>> = {
  renderer: 'openwaggle',
  'extension-runtime': OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME,
  'extension-frame': OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME,
  'inline-visualization': INLINE_VISUALIZATION_PROTOCOL.SCHEME,
  'mcp-app-frame': MCP_APP_FRAME_PROTOCOL.SCHEME,
  'session-resource': SESSION_RESOURCE_PROTOCOL.SCHEME,
}
