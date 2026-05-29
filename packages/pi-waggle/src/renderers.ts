import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
  parsePiWaggleTurnDetails,
} from './protocol'
import { truncateTerminalLine } from './terminal-text'

type MessageRendererRegistrar = Pick<ExtensionAPI, 'registerMessageRenderer'>

function singleLineComponent(line: string) {
  return {
    invalidate: () => undefined,
    render: (width: number) => [truncateTerminalLine(line, width)],
  }
}

export function registerPiWaggleRenderers(pi: MessageRendererRegistrar) {
  pi.registerMessageRenderer(PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE, (message) =>
    singleLineComponent(`🐝 Waggle request: ${String(message.content)}`),
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
