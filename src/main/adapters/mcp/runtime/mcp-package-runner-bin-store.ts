/** The Host's saved package-runner resolutions (D1.2). */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { createLogger } from '../../../logger'
import { type ResolvedPackageBin, readJson } from './mcp-package-runner-bins'

const BINS_DIRECTORY_MODE = 0o700
const BINS_FILE_MODE = 0o600

const logger = createLogger('mcp-package-runner')

const ResolvedPackageBinSchema = Schema.Struct({
  command: Schema.String,
  prefixArgs: Schema.Array(Schema.String),
  binDirectory: Schema.String,
  resolvedAt: Schema.Number,
  pinned: Schema.Boolean,
})
const StoredResolutionsSchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Record({ key: Schema.String, value: ResolvedPackageBinSchema }),
})
export interface PackageBinStore {
  readonly load: () => Record<string, ResolvedPackageBin>
  readonly save: (entries: Record<string, ResolvedPackageBin>) => void
}

/** A JSON file of resolutions, so a new Session Host does not start every server via its runner. */
export function fileBackedPackageBinStore(file: () => string): PackageBinStore {
  return {
    load: () => {
      let text: string
      try {
        text = readFileSync(file(), 'utf8')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          logger.warn('Could not read the MCP package runner resolutions', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        return {}
      }
      const stored = safeDecodeUnknown(StoredResolutionsSchema, readJson(text))
      if (stored.success) return { ...stored.data.entries }
      // Every runner launch is probed again, and the file rewritten.
      logger.warn('The MCP package runner resolutions file is unreadable; it is ignored')
      return {}
    },
    save: (entries) => {
      try {
        // The keys hold the user's PATH: private, like the rest of `<userData>/mcp`, and replaced
        // whole, so a crash mid-write does not lose every resolution (review R5 P3-2).
        mkdirSync(path.dirname(file()), { recursive: true, mode: BINS_DIRECTORY_MODE })
        const stored = { version: 1, entries } satisfies typeof StoredResolutionsSchema.Type
        const temporary = `${file()}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify(stored), { mode: BINS_FILE_MODE })
        renameSync(temporary, file())
      } catch (error) {
        // A resolution that is not saved is probed again by the next Host.
        logger.warn('Could not save the MCP package runner resolutions', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
