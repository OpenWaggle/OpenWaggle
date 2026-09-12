import {
  callMcpAppToolOperation,
  getMcpPromptOperation,
  listMcpCapabilitiesOperation,
  listMcpEventSubscriptionsOperation,
  listMcpEventsOperation,
  operateMcpTaskOperation,
  readMcpResourceOperation,
  reviewMcpRemoteSkillOperation,
  setMcpEventSubscriptionOperation,
} from '../application/mcp-capability-operations'
import { hostHandle } from './typed-ipc'

export function registerMcpCapabilityHandlers(): void {
  hostHandle('mcp:list-capabilities', (_event, raw: unknown) => listMcpCapabilitiesOperation(raw))
  hostHandle('mcp:get-prompt', (_event, raw: unknown) => getMcpPromptOperation(raw))
  hostHandle('mcp:read-resource', (_event, raw: unknown) => readMcpResourceOperation(raw))
  hostHandle('mcp:review-remote-skill', (_event, raw: unknown) =>
    reviewMcpRemoteSkillOperation(raw),
  )
  hostHandle('mcp:operate-task', (_event, raw: unknown) => operateMcpTaskOperation(raw))
  hostHandle('mcp:call-app-tool', (_event, raw: unknown) => callMcpAppToolOperation(raw))
  hostHandle('mcp:set-event-subscription', (_event, raw: unknown) =>
    setMcpEventSubscriptionOperation(raw),
  )
  hostHandle('mcp:list-events', (_event, raw = {}) => listMcpEventsOperation(raw))
  hostHandle('mcp:list-event-subscriptions', (_event, raw = {}) =>
    listMcpEventSubscriptionsOperation(raw),
  )
}
