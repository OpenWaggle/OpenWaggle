import { readFile } from 'node:fs/promises'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { scheduledTaskInputSchema } from '@shared/schemas/scheduled-task'
import type { ScheduledTaskInput } from '@shared/types/scheduled-task'
import { asUsageErrorsSync } from './cli-error'
import { CommandCliUsageError } from './command-cli-option-contract'
import {
  SCHEDULED_TASKS_EXPORT_SCHEMA_VERSION,
  SCHEDULED_TASKS_EXPORT_TYPE,
} from './schedules-cli-output'

const importedTasksSchema = Schema.Array(scheduledTaskInputSchema)
const exportV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  type: Schema.Literal(SCHEDULED_TASKS_EXPORT_TYPE),
  tasks: importedTasksSchema,
})

/**
 * Every export version this release imports, each with its own exact schema. A later version
 * adds its schema here and keeps the earlier ones, so a release still reads every export an
 * earlier release of the major wrote.
 */
const IMPORTABLE_EXPORT_VERSIONS: ReadonlyMap<
  number,
  (parsed: unknown) => readonly ScheduledTaskInput[]
> = new Map([[1, (parsed: unknown) => decodeUnknownExactOrThrow(exportV1Schema, parsed).tasks]])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownExportVersionRefusal(version: unknown) {
  return new CommandCliUsageError(
    typeof version === 'number' && version > SCHEDULED_TASKS_EXPORT_SCHEMA_VERSION
      ? `This export has schemaVersion ${String(version)}, written by a newer OpenWaggle. This version imports schemaVersion ${String(SCHEDULED_TASKS_EXPORT_SCHEMA_VERSION)} and earlier. Update OpenWaggle, then import the file again.`
      : `This export has schemaVersion ${String(version)}, which no OpenWaggle writes.`,
  )
}

/**
 * The tasks in what `schedules export` printed (ADR 0063): the `scheduled-tasks` envelope, or the
 * bare task array betas before 1.0 printed. Both stay importable for all of 1.x. An envelope with
 * a newer `schemaVersion` is refused, so a newer export is never half-read.
 */
function importedScheduledTasks(parsed: unknown): readonly ScheduledTaskInput[] {
  if (Array.isArray(parsed)) return decodeUnknownExactOrThrow(importedTasksSchema, parsed)
  if (isRecord(parsed) && parsed['type'] === SCHEDULED_TASKS_EXPORT_TYPE) {
    const decode =
      typeof parsed['schemaVersion'] === 'number'
        ? IMPORTABLE_EXPORT_VERSIONS.get(parsed['schemaVersion'])
        : undefined
    if (!decode) throw unknownExportVersionRefusal(parsed['schemaVersion'])
    return decode(parsed)
  }
  return decodeUnknownExactOrThrow(importedTasksSchema, [parsed])
}

export async function readImport(source: string | undefined) {
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
  return asUsageErrorsSync(() => importedScheduledTasks(parseJsonUnknown(text)))
}
