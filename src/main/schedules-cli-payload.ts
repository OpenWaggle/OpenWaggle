import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { scheduledTaskInputSchema } from '@shared/schemas/scheduled-task'
import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  SCHEDULED_TASKS_CONTRACT_VERSION,
  type ScheduledTaskInput,
  type ScheduledTaskNotificationPolicy,
  type ScheduledTaskPatch,
  type ScheduledTasksCommand,
  type ScheduledTasksRequest,
  type ScheduledTaskTarget,
  type TaskSchedule,
} from '@shared/types/scheduled-task'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { sessionIdFromReference } from '@shared/utils/session-link'
import { CommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'

const DAYS_PER_WEEK_PATTERN = /^[1-7](,[1-7])*$/
const MINUTES_PER_HOUR = 60
const WORKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5]

function required(value: string | undefined, label: string) {
  if (!value) throw new CommandCliUsageError(`Missing ${label}.`)
  return value
}

function sessionArgument(value: string | undefined, label: string) {
  return sessionIdFromReference(required(value, label), label)
}

function positiveWhole(value: string, label: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new CommandCliUsageError(`${label} must be a whole number.`)
  return Number(value)
}

/** `--every 30m`, `--every 2h`, or a plain number of minutes. */
function everyMinutes(value: string) {
  const match = /^(?<amount>\d+)\s*(?<unit>m|min|h|hr)?$/i.exec(value.trim())
  const amountText = match?.groups?.amount
  if (!amountText) throw new CommandCliUsageError('--every takes minutes (30, 30m) or hours (2h).')
  const amount = Number(amountText)
  const unit = (match?.groups?.unit ?? 'm').toLowerCase()
  return unit.startsWith('h') ? amount * MINUTES_PER_HOUR : amount
}

function weekdays(value: string | undefined): readonly IsoWeekday[] | undefined {
  if (value === undefined) return undefined
  if (value === 'weekdays') return WORKDAYS
  if (!DAYS_PER_WEEK_PATTERN.test(value)) {
    throw new CommandCliUsageError(
      '--weekdays takes ISO days 1-7 separated by commas (1 is Monday), or "weekdays".',
    )
  }
  return [...new Set(value.split(',').map(Number))].flatMap((day) =>
    ISO_WEEKDAYS.filter((candidate) => candidate === day),
  )
}

/** The schedule the options name, or undefined when they name none. */
export function scheduleFromOptions(arguments_: ParsedArguments): TaskSchedule | undefined {
  const every = option(arguments_, 'every')
  const daily = option(arguments_, 'daily')
  const rule = option(arguments_, 'rrule')
  const named = [every, daily, rule].filter((value) => value !== undefined)
  if (named.length > 1)
    throw new CommandCliUsageError('Choose one of --every, --daily, or --rrule.')
  if (every !== undefined) return { kind: 'interval', everyMinutes: everyMinutes(every) }
  if (daily !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(daily))
      throw new CommandCliUsageError('--daily takes HH:MM (24-hour).')
    const days = weekdays(option(arguments_, 'weekdays'))
    return { kind: 'daily', at: daily, ...(days ? { weekdays: days } : {}) }
  }
  if (option(arguments_, 'weekdays') !== undefined) {
    throw new CommandCliUsageError('--weekdays needs --daily HH:MM.')
  }
  return rule !== undefined ? { kind: 'rrule', rule } : undefined
}

function timestamp(value: string | undefined, label: string) {
  if (value === undefined) return undefined
  if (value === 'none') return null
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  if (!Number.isFinite(parsed))
    throw new CommandCliUsageError(`${label} takes an ISO date or epoch milliseconds.`)
  return parsed
}

function thinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  if (value === undefined) return undefined
  const level = THINKING_LEVELS.find((candidate) => candidate === value)
  if (!level)
    throw new CommandCliUsageError(`--thinking must be one of ${THINKING_LEVELS.join(', ')}.`)
  return level
}

function notificationPolicy(
  value: string | undefined,
): ScheduledTaskNotificationPolicy | undefined {
  if (value === undefined) return undefined
  if (value === 'every-run') return 'every-run'
  if (value === 'failures-only') return 'failures-only'
  throw new CommandCliUsageError('--notify must be every-run or failures-only.')
}

function workspace(value: string | undefined) {
  if (value === undefined || value === 'new-worktree') return 'new-worktree' as const
  if (value === 'local') return 'local' as const
  throw new CommandCliUsageError('--workspace must be new-worktree or local.')
}

async function promptFrom(arguments_: ParsedArguments, words: readonly string[]) {
  const file = option(arguments_, 'prompt-file')
  const inline = option(arguments_, 'prompt')
  const sources = [file, inline, words.length > 0 ? 'words' : undefined].filter(Boolean)
  if (sources.length > 1)
    throw new CommandCliUsageError('Give the prompt once: --prompt, --prompt-file, or words.')
  if (file) return (await readFile(file, 'utf8')).trimEnd()
  if (inline) return inline
  return words.length > 0 ? words.join(' ') : undefined
}

function launchTarget(projectPath: string, arguments_: ParsedArguments): ScheduledTaskTarget {
  const model = option(arguments_, 'model')
  const thinking = thinkingLevel(option(arguments_, 'thinking'))
  const agent = option(arguments_, 'agent')
  return {
    kind: 'launch',
    projectPath: path.resolve(projectPath),
    workspace: workspace(option(arguments_, 'workspace')),
    ...(model ? { modelId: model } : {}),
    ...(thinking ? { thinkingLevel: thinking } : {}),
    ...(agent ? { agentDefinitionName: agent } : {}),
    archiveFinishedSessions: hasFlag(arguments_, 'archive-finished'),
  }
}

function commonFields(arguments_: ParsedArguments) {
  const timeZone = option(arguments_, 'time-zone')
  const endsAt = timestamp(option(arguments_, 'ends'), '--ends')
  const maxRunsOption = option(arguments_, 'max-runs')
  const policy = notificationPolicy(option(arguments_, 'notify'))
  return {
    ...(timeZone ? { timeZone } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
    ...(maxRunsOption !== undefined
      ? { maxRuns: maxRunsOption === 'none' ? null : positiveWhole(maxRunsOption, '--max-runs') }
      : {}),
    ...(policy ? { notificationPolicy: policy } : {}),
  }
}

async function createCommand(arguments_: ParsedArguments): Promise<ScheduledTasksCommand> {
  const [kind, targetArgument, ...words] = arguments_.positionals
  if (kind !== 'heartbeat' && kind !== 'launch') {
    throw new CommandCliUsageError('create needs heartbeat <session> or launch <project-path>.')
  }
  const target: ScheduledTaskTarget =
    kind === 'heartbeat'
      ? { kind: 'heartbeat', sessionId: sessionArgument(targetArgument, 'the Heartbeat Session') }
      : launchTarget(required(targetArgument, 'the Launch schedule project path'), arguments_)
  const schedule = scheduleFromOptions(arguments_)
  if (!schedule) throw new CommandCliUsageError('create needs --every, --daily, or --rrule.')
  const prompt = await promptFrom(arguments_, words)
  const input: ScheduledTaskInput = {
    name: required(option(arguments_, 'name'), '--name'),
    prompt: required(prompt, 'the prompt (--prompt, --prompt-file, or words)'),
    enabled: !hasFlag(arguments_, 'paused'),
    schedule,
    target,
    ...commonFields(arguments_),
  }
  return { operation: 'create', input }
}

async function updateCommand(arguments_: ParsedArguments): Promise<ScheduledTasksCommand> {
  const [taskId, ...words] = arguments_.positionals
  const schedule = scheduleFromOptions(arguments_)
  const name = option(arguments_, 'name')
  const prompt = await promptFrom(arguments_, words)
  const patch: ScheduledTaskPatch = {
    ...(name ? { name } : {}),
    ...(prompt ? { prompt } : {}),
    ...(schedule ? { schedule } : {}),
    ...commonFields(arguments_),
  }
  if (Object.keys(patch).length === 0)
    throw new CommandCliUsageError('update needs at least one change.')
  return { operation: 'update', taskId: required(taskId, 'the task id'), patch }
}

const importedTasksSchema = Schema.Array(scheduledTaskInputSchema)

async function readImport(source: string | undefined) {
  const text =
    source === undefined || source === '-'
      ? await new Promise<string>((resolve, reject) => {
          let data = ''
          process.stdin.setEncoding('utf8')
          process.stdin.on('data', (chunk) => {
            data += String(chunk)
          })
          process.stdin.on('end', () => resolve(data))
          process.stdin.on('error', reject)
        })
      : await readFile(source, 'utf8')
  const parsed = parseJsonUnknown(text)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return decodeUnknownExactOrThrow(importedTasksSchema, list)
}

function listCommand(arguments_: ParsedArguments): ScheduledTasksCommand {
  const project = option(arguments_, 'project')
  const session = option(arguments_, 'session')
  return {
    operation: 'list',
    ...(project ? { projectPath: path.resolve(project) } : {}),
    ...(session ? { sessionId: sessionIdFromReference(session, '--session') } : {}),
  }
}

function runsCommand(arguments_: ParsedArguments): ScheduledTasksCommand {
  const limit = option(arguments_, 'limit')
  const before = timestamp(option(arguments_, 'before'), '--before')
  return {
    operation: 'runs',
    taskId: required(arguments_.positionals[0], 'the task id'),
    ...(limit ? { limit: positiveWhole(limit, '--limit') } : {}),
    ...(typeof before === 'number' ? { before } : {}),
  }
}

function taskId(arguments_: ParsedArguments) {
  return required(arguments_.positionals[0], 'the task id')
}

type CommandBuilder = (
  arguments_: ParsedArguments,
) => Promise<readonly ScheduledTasksCommand[]> | readonly ScheduledTasksCommand[]

const COMMAND_BUILDERS: Readonly<Record<string, CommandBuilder>> = {
  list: (arguments_) => [listCommand(arguments_)],
  export: (arguments_) => [listCommand(arguments_)],
  show: (arguments_) => [{ operation: 'read', taskId: taskId(arguments_) }],
  runs: (arguments_) => [runsCommand(arguments_)],
  create: async (arguments_) => [await createCommand(arguments_)],
  update: async (arguments_) => [await updateCommand(arguments_)],
  pause: (arguments_) => [
    { operation: 'update', taskId: taskId(arguments_), patch: { enabled: false } },
  ],
  resume: (arguments_) => [
    { operation: 'update', taskId: taskId(arguments_), patch: { enabled: true } },
  ],
  delete: (arguments_) => [{ operation: 'delete', taskId: taskId(arguments_) }],
  run: (arguments_) => [{ operation: 'run-now', taskId: taskId(arguments_) }],
  import: async (arguments_) =>
    (await readImport(arguments_.positionals[0])).map((input) => ({ operation: 'create', input })),
}

/** The commands one CLI invocation sends; `import` sends one create per task. */
export async function buildSchedulesCliCommands(
  command: string,
  arguments_: ParsedArguments,
): Promise<readonly ScheduledTasksCommand[]> {
  const builder = COMMAND_BUILDERS[command]
  if (!builder)
    throw new CommandCliUsageError(`Unsupported OpenWaggle Schedules command: ${command}.`)
  return builder(arguments_)
}

export function schedulesCliRequest(
  command: ScheduledTasksCommand,
  idempotencyKey: string | undefined,
): ScheduledTasksRequest {
  return {
    contractVersion: SCHEDULED_TASKS_CONTRACT_VERSION,
    requestId: randomUUID(),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    command,
  }
}
