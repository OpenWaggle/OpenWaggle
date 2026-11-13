import type { SessionCapability } from '@shared/types/session-capability'
import {
  joinCapabilities,
  SCHEDULE_ACTION_PREFIX,
  type SessionsToolActionGrant,
  sessionsToolActionPermission,
} from './sessions-tool-capability-schema'
import { SCHEDULES_WITHHELD_REASON as SCHEDULES_WITHHELD } from './sessions-tool-schedule-guidelines'

function lacks(grant: SessionsToolActionGrant, capability: SessionCapability) {
  return grant.capabilities !== undefined && !grant.capabilities.includes(capability)
}

/**
 * What help says when this Session's grant leaves out Scheduled tasks, which the hive tool's
 * description and the docs offer every agent: without it the schedule actions would just be
 * missing, with no reason and no way forward.
 */
export function scheduledTasksUnavailableNote(grant: SessionsToolActionGrant) {
  const read = !lacks(grant, 'schedules:read')
  const manage = !lacks(grant, 'schedules:manage')
  if (read && manage) return undefined
  if (!read && !manage) {
    return `Scheduled tasks are not available to this Session: it has no schedules:read or schedules:manage, so the hive tool offers it no schedule_* action. ${SCHEDULES_WITHHELD}`
  }
  if (read) {
    return `This Session has schedules:read but no schedules:manage: it can list and read Scheduled tasks, but cannot add, change, run or delete them, or report a Heartbeat outcome. ${SCHEDULES_WITHHELD}`
  }
  return `This Session has schedules:manage but no schedules:read: it cannot list or read Scheduled tasks or their runs. ${SCHEDULES_WITHHELD}`
}

/** The notes help lists under "Not available to this Session". */
export function sessionsToolUnavailableNotes(grant: SessionsToolActionGrant) {
  const note = scheduledTasksUnavailableNote(grant)
  return note ? [note] : []
}

/**
 * Why `help` with `topic` cannot describe a real action this Session may not use; undefined for
 * a permitted or unknown one.
 */
export function sessionsToolUnavailableTopic(action: string, grant: SessionsToolActionGrant) {
  const permission = sessionsToolActionPermission(action, grant)
  if (permission.permitted || permission.reason === 'unknown-action') return undefined
  if (permission.reason === 'multi-agent-disabled') {
    return `The hive action ${action} is not available to this Session: multi-agent work is turned off for this project or model.`
  }
  const denial = `The hive action ${action} is not available to this Session: it requires ${joinCapabilities(permission.required, 'and')}, and this Session has no ${joinCapabilities(permission.missing, 'or')}.`
  if (!action.startsWith(SCHEDULE_ACTION_PREFIX)) return denial
  return `${denial} ${SCHEDULES_WITHHELD}`
}
