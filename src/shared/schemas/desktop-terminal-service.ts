import { TERMINAL } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import type {
  DesktopTerminalCommand,
  DesktopTerminalResult,
} from '@shared/types/desktop-terminal-service'
import { terminalEnvironmentSchema } from './terminal'

const MAX_DESKTOP_TERMINAL_ID_LENGTH = 8192
const MAX_DESKTOP_TERMINAL_TEXT_LENGTH = 4 * 1024 * 1024
const MAX_DESKTOP_TERMINAL_PORTS = 1024
const MAX_DESKTOP_TERMINAL_SNAPSHOTS = 4096

const id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_DESKTOP_TERMINAL_ID_LENGTH))
const integer = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const text = Schema.String.pipe(Schema.maxLength(MAX_DESKTOP_TERMINAL_TEXT_LENGTH))
const target = { ownerKey: id, terminalId: id }
const dimensions = {
  cols: Schema.Number.pipe(Schema.int(), Schema.between(TERMINAL.MIN_COLS, TERMINAL.MAX_COLS)),
  rows: Schema.Number.pipe(Schema.int(), Schema.between(TERMINAL.MIN_ROWS, TERMINAL.MAX_ROWS)),
}
const identity = Schema.Struct({ generation: id, sequence: integer })
const open = Schema.Struct({
  ...target,
  ...dimensions,
  cwd: id,
  env: Schema.optional(terminalEnvironmentSchema),
  inputGeneration: Schema.optional(id),
})

function command<K extends string, A>(operation: K, input: Schema.Schema<A>) {
  return Schema.Struct({
    service: Schema.Literal('terminal'),
    operation: Schema.Literal(operation),
    input,
  })
}

export const desktopTerminalCommandSchema: Schema.Schema<DesktopTerminalCommand> = Schema.Union(
  command('getActivitySnapshot', Schema.Struct({})),
  command('open', open),
  command('restart', open),
  command(
    'write',
    Schema.Struct({
      ...target,
      data: Schema.String.pipe(Schema.maxLength(TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES)),
      identity: Schema.optional(identity),
      intent: Schema.optional(
        Schema.Struct({ kind: Schema.Literal('project-action'), executionId: id }),
      ),
    }),
  ),
  command('sendInputNow', Schema.Struct(target)),
  command(
    'acknowledgeOutput',
    Schema.Struct({ ...target, outputGeneration: integer, endOffset: integer }),
  ),
  command('migrateOwner', Schema.Struct({ fromOwnerKey: id, toOwnerKey: id })),
  command('resize', Schema.Struct({ ...target, ...dimensions })),
  command('clear', Schema.Struct(target)),
  command('assessClose', Schema.Struct(target)),
  command('close', Schema.Struct({ ...target, deleteHistory: Schema.Boolean })),
  command('closeAllForOwner', Schema.Struct({ ownerKey: id, deleteHistory: Schema.Boolean })),
  command('closeAllUnderPath', Schema.Struct({ directoryPath: id, deleteHistory: Schema.Boolean })),
  command('attachSurface', Schema.Struct({ terminalKey: id, surfaceId: integer })),
  command('detachTerminal', Schema.Struct({ ...target, surfaceId: integer })),
  command('detachSurface', Schema.Struct({ surfaceId: integer })),
  command('closeAll', Schema.Struct({})),
)

const ports = Schema.Array(integer).pipe(Schema.maxItems(MAX_DESKTOP_TERMINAL_PORTS))
const portPreviews = Schema.Array(Schema.Struct({ host: id, port: integer, url: id })).pipe(
  Schema.maxItems(MAX_DESKTOP_TERMINAL_PORTS),
)
const attach = Schema.Struct({
  history: text,
  outputBytes: integer,
  outputGeneration: integer,
  readiness: Schema.NullOr(
    Schema.Struct({
      phase: Schema.Literal('spawning', 'awaiting-prompt', 'ready'),
      generation: integer,
    }),
  ),
  pendingInputBytes: Schema.optional(integer),
  running: Schema.Boolean,
  cwdMissing: Schema.optional(Schema.Boolean),
  exitCode: Schema.optional(Schema.Number),
  processName: Schema.NullOr(text),
  ports,
  portPreviews: Schema.optional(portPreviews),
  projectActionPending: Schema.Boolean,
})
const write = Schema.Union(
  Schema.Struct({
    status: Schema.Literal('written', 'queued'),
    acceptedBytes: integer,
    identity: Schema.optional(identity),
  }),
  Schema.Struct({
    status: Schema.Literal('rejected'),
    acceptedBytes: Schema.Literal(0),
    identity: Schema.optional(identity),
    reason: Schema.Literal(
      'empty',
      'input-too-large',
      'queue-full',
      'terminal-not-open',
      'stale-generation',
      'stale-sequence',
      'sequence-gap',
      'sequence-conflict',
      'project-action-pending',
    ),
  }),
)

function result<K extends string, A>(operation: K, value: Schema.Schema<A>) {
  return Schema.Struct({
    service: Schema.Literal('terminal'),
    operation: Schema.Literal(operation),
    value,
  })
}

export const desktopTerminalResultSchema: Schema.Schema<DesktopTerminalResult> = Schema.Union(
  result(
    'getActivitySnapshot',
    Schema.Struct({
      revision: integer,
      truncated: Schema.Boolean,
      summaries: Schema.Array(
        Schema.Struct({
          ...target,
          activityStatus: Schema.Literal('unknown', 'idle', 'running'),
          processName: Schema.NullOr(text),
          ports,
          portPreviews: Schema.optional(portPreviews),
          projectActionPending: Schema.Boolean,
        }),
      ).pipe(Schema.maxItems(MAX_DESKTOP_TERMINAL_SNAPSHOTS)),
    }),
  ),
  result('open', attach),
  result('restart', attach),
  result('write', write),
  result(
    'sendInputNow',
    Schema.Union(
      Schema.Struct({ status: Schema.Literal('released'), releasedBytes: integer }),
      Schema.Struct({
        status: Schema.Literal('already-ready', 'terminal-not-open'),
        releasedBytes: Schema.Literal(0),
      }),
    ),
  ),
  result(
    'migrateOwner',
    Schema.Struct({
      terminalIds: Schema.Array(id).pipe(Schema.maxItems(MAX_DESKTOP_TERMINAL_SNAPSHOTS)),
    }),
  ),
  result(
    'assessClose',
    Schema.Union(
      Schema.Struct({
        disposition: Schema.Literal('safe'),
        reason: Schema.Literal('dead', 'idle'),
      }),
      Schema.Struct({
        disposition: Schema.Literal('confirm'),
        reason: Schema.Literal('active', 'uncertain'),
        processNames: Schema.Array(text).pipe(Schema.maxItems(MAX_DESKTOP_TERMINAL_SNAPSHOTS)),
        ports,
      }),
    ),
  ),
  result('acknowledgeOutput', Schema.Null),
  result('resize', Schema.Null),
  result('clear', Schema.Null),
  result('close', Schema.Null),
  result('closeAllForOwner', Schema.Null),
  result('closeAllUnderPath', Schema.Null),
  result('attachSurface', Schema.Null),
  result('detachTerminal', Schema.Null),
  result('detachSurface', Schema.Null),
  result('closeAll', Schema.Null),
)
