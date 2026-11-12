import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
  parsePiWaggleTurnDetails,
} from './protocol.js'
import { truncateTerminalLine } from './terminal-text.js'

type MessageRendererRegistrar = Pick<ExtensionAPI, 'registerMessageRenderer'>

function singleLineComponent(line: string) {
  return {
    invalidate: () => undefined,
    render: (width: number) => [truncateTerminalLine(line, width)],
  }
}

function messageText(
  content: string | readonly { readonly type: string; readonly text?: string }[],
) {
  if (typeof content === 'string') return content
  return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
}

export function registerPiWaggleRenderers(pi: MessageRendererRegistrar) {
  pi.registerMessageRenderer(PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE, (message) =>
    singleLineComponent(`🐝 Waggle request: ${messageText(message.content)}`),
  )

  pi.registerMessageRenderer(PI_WAGGLE_TURN_CUSTOM_TYPE, (message) => {
    const details = parsePiWaggleTurnDetails(message.details)
    if (!details) {
      return singleLineComponent('🐝 Waggle turn')
    }

    return singleLineComponent(
      `🐝 Turn ${String(details.turnNumber + 1)} · ${details.agentLabel} · ${details.agentModel}`,
    )
  })
}
