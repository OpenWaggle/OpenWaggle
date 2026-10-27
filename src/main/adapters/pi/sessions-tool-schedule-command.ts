import { randomUUID } from 'node:crypto'
import { decodeTaskSchedule } from '@shared/schemas/scheduled-task'
import {
  type LaunchScheduleWorkspace,
  type LocalScheduledTasksCommandPayload,
  SCHEDULED_TASKS_CONTRACT_VERSION,
  type ScheduledTaskKind,
  type ScheduledTaskNotificationPolicy,
  type ScheduledTaskPatch,
  type ScheduledTasksCommand,
  type ScheduledTasksOperation,
  type ScheduledTaskTarget,
  type TaskSchedule,
} from '@shared/types/scheduled-task'
import {
  assertHeartbeatCanFinish,
  givenHeartbeatSettings,
  type HeartbeatCommandFields,
  heartbeatSettingsInput,
  heartbeatTarget,
  reportOutcomeCommand,
} from './sessions-tool-schedule-heartbeat'
import { sessionsToolThinkingLevel } from './sessions-tool-thinking'

/**
 * The flat Scheduled task fields the Pi-native hive tool and the openwaggle_hive MCP tool both accept.
 * Each adapter validates its own transport schema first; this module maps the fields onto one
 * `scheduled-tasks-v1` command so the two surfaces keep the same semantics.
 */
export interface ScheduleCommandFields extends HeartbeatCommandFields {
  readonly scheduleTaskId?: string
  readonly name?: string
  readonly prompt?: string
  readonly scheduleKind?: ScheduledTaskKind
  readonly schedule?: unknown
  readonly timeZone?: string
  readonly endsAt?: string | number | null
  readonly maxRuns?: number | null
  readonly enabled?: boolean
  readonly notificationPolicy?: ScheduledTaskNotificationPolicy
  readonly sessionId?: string
  readonly projectPath?: string
  readonly workspace?: string
  readonly agent?: string
  readonly archiveFinishedSessions?: boolean
  readonly limit?: number
  readonly before?: string | number
}

/** Values an adapter may fill in when the caller omits them. */
export interface ScheduleCommandDefaults {
  /** The calling Session, which a Heartbeat created by an agent targets by default. */
  readonly heartbeatSessionId?: string
  /** The calling Session's project, which a Launch schedule targets by default. */
  readonly launchProjectPath?: string
  /** The calling Run, which reports its own Run outcome. */
  readonly runId?: string
}

const LAUNCH_ONLY_FIELDS = ['projectPath', 'workspace', 'agent', 'archiveFinishedSessions'] as const
const MODEL_FIELDS = ['model', 'thinking'] as const

function requiredTaskId(fields: ScheduleCommandFields, operation: ScheduledTasksOperation) {
  if (!fields.scheduleTaskId)
    throw new Error(`Scheduled task ${operation} requires scheduleTaskId.`)
  return fields.scheduleTaskId
}

/** An ISO date-time or epoch milliseconds, as epoch milliseconds. */
export function scheduleTimestamp(value: string | number, field: string) {
  const epoch = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error(`${field} must be an ISO date-time or epoch milliseconds.`)
  }
  return epoch
}

function taskSchedule(value: unknown): TaskSchedule {
  try {
    return decodeTaskSchedule(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid schedule. Use {kind:'interval', everyMinutes}, {kind:'daily', at:'HH:MM', weekdays?:[1..7]} with 1 = Monday, or {kind:'rrule', rule}. ${detail}`,
      { cause: error },
    )
  }
}

function launchWorkspace(value: string | undefined): LaunchScheduleWorkspace | undefined {
  if (value === undefined) return undefined
  if (value === 'new-worktree' || value === 'local') return value
  throw new Error('A Launch schedule workspace is new-worktree or local.')
}

function givenLaunchFields(fields: ScheduleCommandFields) {
  return LAUNCH_ONLY_FIELDS.filter((field) => fields[field] !== undefined)
}

/** Whether an update changes target fields, which needs the task's current target. */
export function scheduleUpdateChangesTarget(fields: ScheduleCommandFields) {
  return (
    givenLaunchFields(fields).length > 0 ||
    MODEL_FIELDS.some((field) => fields[field] !== undefined)
  )
}

type LaunchTarget = Extract<ScheduledTaskTarget, { kind: 'launch' }>

/** The optional Launch settings: given fields win, then the current target's. */
function launchSpecialization(fields: ScheduleCommandFields, base: LaunchTarget | undefined) {
  const thinkingLevel = sessionsToolThinkingLevel(fields.thinking) ?? base?.thinkingLevel
  const modelId = fields.model ?? base?.modelId
  const agentDefinitionName = fields.agent ?? base?.agentDefinitionName
  return {
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(agentDefinitionName ? { agentDefinitionName } : {}),
  }
}

function launchTarget(
  fields: ScheduleCommandFields,
  base: LaunchTarget | undefined,
  defaults: ScheduleCommandDefaults,
): ScheduledTaskTarget {
  const projectPath = fields.projectPath ?? base?.projectPath ?? defaults.launchProjectPath
  if (!projectPath) throw new Error('A Launch schedule requires projectPath.')
  return {
    kind: 'launch',
    projectPath,
    workspace: launchWorkspace(fields.workspace) ?? base?.workspace ?? 'new-worktree',
    ...launchSpecialization(fields, base),
    archiveFinishedSessions:
      fields.archiveFinishedSessions ?? base?.archiveFinishedSessions ?? false,
  }
}

function createTarget(
  fields: ScheduleCommandFields,
  defaults: ScheduleCommandDefaults,
): ScheduledTaskTarget {
  if (fields.scheduleKind === 'heartbeat') {
    const launchOnly = givenLaunchFields(fields)
    if (launchOnly.length > 0) {
      throw new Error(`${launchOnly.join(', ')} apply only to a Launch schedule.`)
    }
    const sessionId = fields.sessionId ?? defaults.heartbeatSessionId
    if (!sessionId) throw new Error('A Heartbeat requires sessionId, the Session it delivers into.')
    return heartbeatTarget(sessionId, fields)
  }
  if (fields.scheduleKind !== 'launch') {
    throw new Error('Scheduled task create requires scheduleKind heartbeat or launch.')
  }
  assertNoHeartbeatSettings(fields)
  if (fields.sessionId !== undefined) {
    throw new Error('sessionId applies only to a Heartbeat; a Launch schedule names a project.')
  }
  return launchTarget(fields, undefined, defaults)
}

function assertNoHeartbeatSettings(fields: ScheduleCommandFields) {
  const heartbeatOnly = givenHeartbeatSettings(fields)
  if (heartbeatOnly.length > 0) {
    throw new Error(`${heartbeatOnly.join(', ')} apply only to a Heartbeat.`)
  }
}

function timingFields(fields: ScheduleCommandFields) {
  return {
    ...(fields.timeZone !== undefined ? { timeZone: fields.timeZone } : {}),
    ...(fields.endsAt !== undefined
      ? { endsAt: fields.endsAt === null ? null : scheduleTimestamp(fields.endsAt, 'endsAt') }
      : {}),
    ...(fields.maxRuns !== undefined ? { maxRuns: fields.maxRuns } : {}),
    ...(fields.notificationPolicy !== undefined
      ? { notificationPolicy: fields.notificationPolicy }
      : {}),
  }
}

function createCommand(
  fields: ScheduleCommandFields,
  defaults: ScheduleCommandDefaults,
): ScheduledTasksCommand {
  if (!fields.name) throw new Error('Scheduled task create requires name.')
  if (!fields.prompt) throw new Error('Scheduled task create requires prompt.')
  if (fields.schedule === undefined) throw new Error('Scheduled task create requires schedule.')
  const timing = timingFields(fields)
  const target = createTarget(fields, defaults)
  if (target.kind === 'heartbeat') {
    assertHeartbeatCanFinish({
      ...(fields.stopWhen !== undefined ? { stopWhen: fields.stopWhen } : {}),
      ...(fields.indefinite !== undefined ? { indefinite: fields.indefinite } : {}),
      endsAt: timing.endsAt ?? null,
      maxRuns: timing.maxRuns ?? null,
    })
  }
  const heartbeat = heartbeatSettingsInput(fields)
  return {
    operation: 'create',
    input: {
      name: fields.name,
      prompt: fields.prompt,
      enabled: fields.enabled ?? true,
      schedule: taskSchedule(fields.schedule),
      ...timing,
      target,
      ...(heartbeat ? { heartbeat } : {}),
    },
  }
}

/** The target an update sets from the given target fields, merged into the current target. */
function updatedTarget(
  fields: ScheduleCommandFields,
  currentTarget: ScheduledTaskTarget | undefined,
) {
  if (!scheduleUpdateChangesTarget(fields)) return undefined
  if (!currentTarget) throw new Error('Updating a task target requires its current target.')
  if (currentTarget.kind === 'launch') return launchTarget(fields, currentTarget, {})
  const launchOnly = givenLaunchFields(fields)
  if (launchOnly.length > 0) {
    throw new Error(`${launchOnly.join(', ')} apply only to a Launch schedule.`)
  }
  return heartbeatTarget(currentTarget.sessionId, fields, currentTarget)
}

function updateCommand(
  fields: ScheduleCommandFields,
  currentTarget: ScheduledTaskTarget | undefined,
): ScheduledTasksCommand {
  const taskId = requiredTaskId(fields, 'update')
  if (fields.scheduleKind !== undefined) {
    throw new Error('A Scheduled task cannot change kind; delete it and create a new one.')
  }
  if (fields.sessionId !== undefined) {
    throw new Error("A Heartbeat's target Session cannot change; delete it and create a new one.")
  }
  const target = updatedTarget(fields, currentTarget)
  const heartbeat = heartbeatSettingsInput(fields)
  const patch: ScheduledTaskPatch = {
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
    ...(fields.enabled !== undefined ? { enabled: fields.enabled } : {}),
    ...(fields.schedule !== undefined ? { schedule: taskSchedule(fields.schedule) } : {}),
    ...timingFields(fields),
    ...(target ? { target } : {}),
    ...(heartbeat ? { heartbeat } : {}),
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('Scheduled task update needs at least one field to change.')
  }
  return { operation: 'update', taskId, patch }
}

/** Maps flat Scheduled task fields onto one `scheduled-tasks-v1` command. */
export function buildScheduledTasksCommand(input: {
  readonly operation: ScheduledTasksOperation
  readonly fields: ScheduleCommandFields
  readonly defaults?: ScheduleCommandDefaults
  /** The task's current target, which an update of Launch target fields merges into. */
  readonly currentTarget?: ScheduledTaskTarget
}): ScheduledTasksCommand {
  const { operation, fields } = input
  if (operation === 'list') {
    return {
      operation,
      ...(fields.projectPath ? { projectPath: fields.projectPath } : {}),
      ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
    }
  }
  if (operation === 'runs') {
    return {
      operation,
      taskId: requiredTaskId(fields, operation),
      ...(fields.limit !== undefined ? { limit: fields.limit } : {}),
      ...(fields.before !== undefined
        ? { before: scheduleTimestamp(fields.before, 'before') }
        : {}),
    }
  }
  if (operation === 'create') return createCommand(fields, input.defaults ?? {})
  if (operation === 'update') return updateCommand(fields, input.currentTarget)
  if (operation === 'report-outcome') return reportOutcomeCommand(fields, input.defaults?.runId)
  if (operation === 'approve-wake-check') {
    throw new Error('A Wake check is approved by the user, never by a tool argument.')
  }
  return { operation, taskId: requiredTaskId(fields, operation) }
}

export function scheduledTasksPayload(
  command: ScheduledTasksCommand,
  idempotencyKey?: string,
): LocalScheduledTasksCommandPayload {
  return {
    contract: 'scheduled-tasks-v1',
    request: {
      contractVersion: SCHEDULED_TASKS_CONTRACT_VERSION,
      requestId: randomUUID(),
      ...(command.operation === 'create' ? { idempotencyKey: idempotencyKey ?? randomUUID() } : {}),
      command,
    },
  }
}
