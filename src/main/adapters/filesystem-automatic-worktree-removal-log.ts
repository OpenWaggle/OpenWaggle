import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type {
  AutomaticWorktreeRemovalLog,
  AutomaticWorktreeRemovalRun,
} from '@shared/types/worktree-inventory'
import { isEnoent } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { createLogger } from '../logger'
import { AutomaticWorktreeRemovalLogStore } from '../ports/automatic-worktree-removal-log'

const logger = createLogger('automatic-worktree-removal-log')

/** Runs kept in the record; older ones are dropped as new ones arrive. */
export const AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT = 20
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const LOG_DIRECTORY = 'worktree-removal'
const LOG_FILE = 'automatic-runs.json'

const removedSchema = Schema.Struct({
  path: Schema.String,
  projectPath: Schema.String,
  branch: Schema.NullOr(Schema.String),
  sessionTitles: Schema.Array(Schema.String),
  reclaimableBytes: Schema.NullOr(Schema.Number),
})

const storedRunSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  archivedDays: Schema.Number,
  removed: Schema.Array(removedSchema),
  failed: Schema.Array(
    Schema.Struct({ path: Schema.String, projectPath: Schema.String, message: Schema.String }),
  ),
  announced: Schema.Boolean,
})

const storedLogSchema = Schema.Struct({
  version: Schema.Literal(1),
  lastCheckedAt: Schema.NullOr(Schema.Number),
  runs: Schema.Array(storedRunSchema),
})

type StoredRun = typeof storedRunSchema.Type
type StoredLog = typeof storedLogSchema.Type

const EMPTY_LOG: StoredLog = { version: 1, lastCheckedAt: null, runs: [] }

function toLog(stored: StoredLog): AutomaticWorktreeRemovalLog {
  const runs = stored.runs.map(({ announced: _announced, ...run }) => run)
  const unannounced = stored.runs.find((run) => !run.announced && run.removed.length > 0)
  return { lastCheckedAt: stored.lastCheckedAt, runs, unannouncedRunId: unannounced?.id ?? null }
}

async function readStoredLog(file: string): Promise<StoredLog> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return EMPTY_LOG
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    logger.warn('Ignoring an unreadable automatic worktree removal record', {
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_LOG
  }
  const decoded = safeDecodeUnknown(storedLogSchema, parsed)
  if (decoded.success) return decoded.data
  logger.warn('Ignoring an invalid automatic worktree removal record', {
    issues: decoded.issues,
  })
  return EMPTY_LOG
}

async function writeStoredLog(file: string, log: StoredLog) {
  await mkdir(path.dirname(file), { recursive: true, mode: DIRECTORY_MODE })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(log)}\n`, { mode: FILE_MODE })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** A JSON record under the user data folder; writes are serialized and atomic. */
export function createAutomaticWorktreeRemovalLogStore(resolveFile: () => string) {
  let writes: Promise<unknown> = Promise.resolve()
  function update<A>(
    change: (log: StoredLog) => { readonly log: StoredLog; readonly result: A },
  ): Promise<A> {
    const next = writes
      .catch(() => undefined)
      .then(async () => {
        const file = resolveFile()
        const changed = change(await readStoredLog(file))
        await writeStoredLog(file, changed.log)
        return changed.result
      })
    writes = next
    return next
  }
  const asError = (message: string) => (cause: unknown) => new Error(message, { cause })
  return AutomaticWorktreeRemovalLogStore.of({
    read: () =>
      Effect.tryPromise({
        try: async () => {
          await writes.catch(() => undefined)
          return toLog(await readStoredLog(resolveFile()))
        },
        catch: asError('Could not read the automatic worktree removal record.'),
      }),
    record: (run: AutomaticWorktreeRemovalRun, options) =>
      Effect.tryPromise({
        try: () =>
          update((log) => {
            // A quiet daily check only moves the check time, so it never pushes out a removal.
            const kept = run.removed.length > 0 || run.failed.length > 0
            const runs = kept
              ? [{ ...run, announced: false } satisfies StoredRun, ...log.runs]
              : log.runs
            return {
              log: {
                version: 1,
                lastCheckedAt: options.checked ? run.startedAt : log.lastCheckedAt,
                runs: runs.slice(0, AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT),
              },
              result: undefined,
            }
          }),
        catch: asError('Could not save the automatic worktree removal record.'),
      }),
    acknowledge: (runId) =>
      Effect.tryPromise({
        try: () =>
          update((log) => {
            const index = log.runs.findIndex((run) => run.id === runId)
            if (index < 0 || log.runs[index]?.announced) return { log, result: false }
            return {
              log: {
                ...log,
                runs: log.runs.map((run, position) =>
                  position >= index ? { ...run, announced: true } : run,
                ),
              },
              result: true,
            }
          }),
        catch: asError('Could not save the automatic worktree removal record.'),
      }),
  })
}

export const AutomaticWorktreeRemovalLogStoreLive = Layer.sync(
  AutomaticWorktreeRemovalLogStore,
  () =>
    createAutomaticWorktreeRemovalLogStore(() =>
      path.join(app.getPath('userData'), LOG_DIRECTORY, LOG_FILE),
    ),
)
