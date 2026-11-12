import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { parseJsonUnknown } from '@shared/schema'
import { uncheckedFields } from '@shared/utils/object-shape'

/**
 * Whether a projected node is a durable OpenWaggle agent-loop audit node rather than a Pi entry.
 * Audit nodes live only in the projection; the Pi session file never contains them.
 */
export function isAgentLoopAuditNode(node: {
  readonly kind: string
  readonly contentJson: string
}) {
  // Session detail reads count Pi entries on every load, so skip parsing unrelated custom nodes.
  if (
    node.kind !== 'custom' ||
    !node.contentJson.includes(OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE)
  ) {
    return false
  }

  try {
    const content = parseJsonUnknown(node.contentJson)
    const { customType } = uncheckedFields<{ readonly customType: string }>(content)
    return customType === OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE
  } catch {
    return false
  }
}
