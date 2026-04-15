import path from 'node:path'
import { COMPOSER } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { FileSuggestion } from '@shared/types/composer'
import * as Effect from 'effect/Effect'
import { buildIgnorePatterns } from '../orchestration/project-context'
import { typedHandle } from './typed-ipc'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))

const DEFAULT_IGNORES = ['node_modules/**', '.git/**', 'dist/**', 'out/**']

export function registerComposerHandlers(): void {
  typedHandle('composer:file-suggest', (_event, rawProjectPath: string, query: string) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)

      const fg = yield* Effect.promise(() => import('fast-glob'))
      const gitignorePatterns = yield* Effect.promise(() => buildIgnorePatterns(projectPath))
      const ignorePatterns = [...new Set([...DEFAULT_IGNORES, ...gitignorePatterns])]

      const pattern = query ? `**/*${sanitizeQuery(query)}*` : '**/*'
      const entries = yield* Effect.promise(() =>
        fg.default(pattern, {
          cwd: projectPath,
          ignore: ignorePatterns,
          caseSensitiveMatch: false,
          onlyFiles: false,
          markDirectories: true,
          absolute: false,
          dot: false,
        }),
      )

      const results: FileSuggestion[] = entries
        .slice(0, COMPOSER.FILE_SUGGEST_LIMIT)
        .map((entry) => ({
          path: entry.endsWith('/') ? entry.slice(0, -1) : entry,
          basename: path.basename(entry.endsWith('/') ? entry.slice(0, -1) : entry),
          isDirectory: entry.endsWith('/'),
        }))

      return results
    }),
  )
}

function sanitizeQuery(input: string): string {
  // Strip path separators to prevent directory traversal, then escape glob metacharacters
  const stripped = input.replace(/[/\\]/g, '').replace(/\.\./g, '')
  return stripped.replace(/[[\]{}()*?!]/g, '\\$&')
}
