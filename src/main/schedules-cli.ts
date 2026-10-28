import type { ScheduledTasksCommand, ScheduledTasksResponse } from '@shared/types/scheduled-task'
import { writeCliStdout } from './cli-stdout'
import { validateCommandCliOptions, validateImplicitCliHelp } from './command-cli-option-contract'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, parseMcpCliArguments } from './mcp-cli-arguments'
import { HEARTBEAT_CLI_FLAGS, HEARTBEAT_CLI_OPTIONS } from './schedules-cli-heartbeat'
import { writeSchedulesCliResponses } from './schedules-cli-output'
import { buildSchedulesCliCommands, schedulesCliRequest } from './schedules-cli-payload'
import {
  SESSION_CLI_EXIT as EXIT,
  sessionCliExitCodeForError,
  sessionCliResultErrorKind,
} from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { writeSessionsCliError } from './sessions-cli-output'

export function schedulesCliUsage() {
  return `OpenWaggle Scheduled tasks

A Scheduled task delivers a prompt on a schedule: a Heartbeat sends it into one existing
Session, a Launch schedule starts a new Session in a project each time. The Session Host runs
them while it is running and the machine is awake.

Usage:
  openwaggle schedules list [--project <path>] [--session <session>]
  openwaggle schedules show <task-id>
  openwaggle schedules runs <task-id> [--limit <n>] [--before <iso|ms>]
  openwaggle schedules create heartbeat <session> --name <name> <schedule> <end> [prompt...]
    [--wake-if <command>] [--wake-on-failure wake|skip] [--idle-pause-after <1-20>]
    [--model <id>] [--thinking <level>]
  openwaggle schedules create launch <project-path> --name <name> <schedule> [prompt...]
    [--workspace new-worktree|local] [--model <id>] [--thinking <level>] [--agent <name>]
    [--archive-finished]
  openwaggle schedules update <task-id> [--name <name>] [<schedule>] [prompt...]
  openwaggle schedules approve-wake-check <task-id>   Approve the Heartbeat's current Wake check
  openwaggle schedules pause <task-id>
  openwaggle schedules resume <task-id>
  openwaggle schedules run <task-id>
  openwaggle schedules delete <task-id>
  openwaggle schedules export [--project <path>]   Print tasks as JSON for import
  openwaggle schedules import [<file>|-]           Create tasks from exported JSON

Schedule (one of):
  --every <minutes|30m|2h>                 At least 5 minutes for a Heartbeat, 15 for a Launch schedule
  --daily <HH:MM> [--weekdays 1,2,3|weekdays]   1 is Monday
  --rrule <rule>                           RFC 5545 rule without DTSTART, UNTIL or COUNT
Heartbeat end (at least one when creating; #388):
  --stop-when <text|none>                  The outcome after which it should stop, in plain words
  --ends <iso|ms>  --max-runs <n>  --indefinite (never ends; --finite undoes it on update)
Heartbeat Wake check:
  --wake-if <command|none>                 Run first in the Session workspace; the agent Run starts
                                           only when it exits non-zero or prints on stdout
  --wake-on-failure wake|skip              A failed or timed-out check wakes by default
  --idle-pause-after <1-20>                Idle runs in a row before it pauses itself (default 3)
Task options:
  --prompt <text> | --prompt-file <path>   Or the prompt as the remaining words
  --time-zone <IANA zone>                  Default: this machine's zone
  --ends <iso|ms|none>  --max-runs <n|none>  --notify every-run|failures-only  --paused

Sessions: a <session> may be a Session link (openwaggle://sessions/<session-id>)
Common: --json, --profile <name> [--credential-stdin|--profile-credential-file <path>]
Mutation replay: --idempotency-key <key> (create)
`
}

const CLIENT_OPTIONS = ['profile', 'credential-stdin', 'profile-credential-file'] as const
const COMMON_OPTIONS = [...CLIENT_OPTIONS, 'json'] as const
const SCHEDULE_OPTIONS = ['every', 'daily', 'weekdays', 'rrule'] as const
const TASK_OPTIONS = [
  ...SCHEDULE_OPTIONS,
  'name',
  'prompt',
  'prompt-file',
  'time-zone',
  'ends',
  'max-runs',
  'notify',
] as const
const LAUNCH_OPTIONS = ['workspace', 'model', 'thinking', 'agent', 'archive-finished'] as const
const UPDATE_OPTIONS = [...TASK_OPTIONS, ...HEARTBEAT_CLI_OPTIONS]
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  help: [],
  list: ['project', 'session'],
  export: ['project', 'session'],
  show: [],
  runs: ['limit', 'before'],
  create: [
    ...TASK_OPTIONS,
    ...HEARTBEAT_CLI_OPTIONS,
    ...LAUNCH_OPTIONS,
    'paused',
    'idempotency-key',
  ],
  update: UPDATE_OPTIONS,
  'approve-wake-check': [],
  pause: [],
  resume: [],
  run: [],
  delete: [],
  import: [],
}
const BOOLEAN_OPTIONS = new Set([
  'credential-stdin',
  'json',
  'paused',
  'archive-finished',
  ...HEARTBEAT_CLI_FLAGS,
])
const ARGUMENTS_BY_COMMAND = {
  help: { minimum: 0, maximum: 0 },
  list: { minimum: 0, maximum: 0 },
  export: { minimum: 0, maximum: 0 },
  show: { minimum: 1, maximum: 1 },
  runs: { minimum: 1, maximum: 1 },
  create: { minimum: 2 },
  update: { minimum: 1 },
  'approve-wake-check': { minimum: 1, maximum: 1 },
  pause: { minimum: 1, maximum: 1 },
  resume: { minimum: 1, maximum: 1 },
  run: { minimum: 1, maximum: 1 },
  delete: { minimum: 1, maximum: 1 },
  import: { minimum: 0, maximum: 1 },
} as const

function resultError(responses: readonly ScheduledTasksResponse[]) {
  const rejected = responses.find((response) => response.outcome.effect === 'rejected')
  return rejected
    ? sessionCliResultErrorKind({ contract: 'scheduled-tasks-v1', response: rejected })
    : undefined
}

type SchedulesCliClient = Awaited<ReturnType<typeof createLocalSessionCliClientInput>>

async function executeSchedulesCommand(
  client: SchedulesCliClient,
  command: ScheduledTasksCommand,
  idempotencyKey: string | undefined,
) {
  const result = await executeLocalSessionCommand({
    ...client,
    payload: {
      contract: 'scheduled-tasks-v1',
      request: schedulesCliRequest(command, idempotencyKey),
    },
  })
  if (result.contract !== 'scheduled-tasks-v1') {
    throw new Error('The Session Host answered with another contract.')
  }
  return result.response
}

/**
 * A run page names no zone, so `runs` reads its task's zone to show the times on the task's own
 * clock, as `show` does. The machine's zone is the fallback; each time names its zone either way.
 */
async function runsTimeZone(
  client: SchedulesCliClient,
  commands: readonly ScheduledTasksCommand[],
) {
  const [command] = commands
  if (commands.length !== 1 || command?.operation !== 'runs') return undefined
  try {
    const response = await executeSchedulesCommand(
      client,
      { operation: 'read', taskId: command.taskId },
      undefined,
    )
    return response.outcome.effect === 'read' ? response.outcome.task.timeZone : undefined
  } catch {
    return undefined
  }
}

/**
 * Approves the Wake check the task runs now: it is read first, so the approval names the exact
 * command, which the output shows (#388).
 */
async function approveWakeCheckCommands(client: SchedulesCliClient, taskId: string) {
  const read = await executeSchedulesCommand(client, { operation: 'read', taskId }, undefined)
  if (read.outcome.effect !== 'read') return [read]
  const command = read.outcome.task.heartbeat?.wakeCheck?.command
  if (!command) {
    return [
      {
        ...read,
        outcome: {
          effect: 'rejected',
          code: 'wake_check_changed',
          message: 'This task has no Wake check to approve.',
        },
      } satisfies ScheduledTasksResponse,
    ]
  }
  return [
    await executeSchedulesCommand(
      client,
      { operation: 'approve-wake-check', taskId, command },
      undefined,
    ),
  ]
}

export async function runSchedulesCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    if (!command) {
      validateImplicitCliHelp('OpenWaggle Schedules', parsed)
      await writeCliStdout(schedulesCliUsage())
      return EXIT.SUCCESS
    }
    validateCommandCliOptions({
      surface: 'OpenWaggle Schedules',
      route: command,
      arguments: arguments_,
      optionsByRoute: OPTIONS_BY_COMMAND,
      commonOptions: COMMON_OPTIONS,
      booleanOptions: BOOLEAN_OPTIONS,
      argumentsByRoute: ARGUMENTS_BY_COMMAND,
    })
    if (command === 'help') {
      await writeCliStdout(schedulesCliUsage())
      return EXIT.SUCCESS
    }
    if (command === 'approve-wake-check') {
      const client = await createLocalSessionCliClientInput(arguments_)
      const responses = await approveWakeCheckCommands(client, arguments_.positionals[0] ?? '')
      await writeSchedulesCliResponses(command, responses, hasFlag(arguments_, 'json'))
      const error = resultError(responses)
      return error ? sessionCliExitCodeForError(error) : EXIT.SUCCESS
    }
    const commands = await buildSchedulesCliCommands(command, arguments_)
    const client = await createLocalSessionCliClientInput(arguments_)
    const idempotencyKey = option(arguments_, 'idempotency-key')
    const responses: ScheduledTasksResponse[] = []
    // One at a time on purpose: an import creates its tasks in file order, so the report lines
    // up with the file and the Host never sees a burst of creates from one invocation.
    for (const scheduledCommand of commands) {
      responses.push(await executeSchedulesCommand(client, scheduledCommand, idempotencyKey))
    }
    const json = hasFlag(arguments_, 'json')
    const timeZone = json ? undefined : await runsTimeZone(client, commands)
    await writeSchedulesCliResponses(command, responses, json, timeZone)
    const error = resultError(responses)
    return error ? sessionCliExitCodeForError(error) : EXIT.SUCCESS
  } catch (error) {
    const kind = writeSessionsCliError(error, hasFlag(arguments_, 'json'))
    return sessionCliExitCodeForError(kind)
  }
}
