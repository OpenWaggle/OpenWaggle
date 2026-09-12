import { type Schema, safeDecodeUnknown } from '@shared/schema'
import { docsListInputSchema } from '@shared/schemas/docs'
import type { DocsListInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { listDocsDiscoveryView } from './docs-discovery-service'

function decodeSchema<A, I>(schema: Schema.Schema<A, I, never>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) return Effect.fail(new Error(decoded.issues.join('; ')))
  return Effect.succeed(decoded.data)
}

function dedupeProjectPaths(projectPaths: readonly string[]) {
  const deduped: string[] = []
  const seenProjectPaths = new Set<string>()
  for (const projectPath of projectPaths) {
    if (!seenProjectPaths.has(projectPath)) {
      seenProjectPaths.add(projectPath)
      deduped.push(projectPath)
    }
  }
  return deduped
}

function validateProjectPaths(
  projectPaths: readonly string[] | undefined,
): Effect.Effect<readonly string[], Error> {
  if (!projectPaths) return Effect.succeed([])
  return Effect.forEach(projectPaths, validateRequiredProjectPath).pipe(
    Effect.map(dedupeProjectPaths),
  )
}

function decodeDocsListInput(raw: unknown): Effect.Effect<DocsListInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) return { projectPaths: [] }
    const decoded = yield* decodeSchema(docsListInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return {
      projectPaths,
      ...(decoded.includeExtensions !== undefined
        ? { includeExtensions: decoded.includeExtensions }
        : {}),
    }
  })
}

export function discoverHostUiDocsWith<A, E, R>(
  input: unknown,
  listDocs: (input: DocsListInput) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const decoded = yield* decodeDocsListInput(input)
    return yield* listDocs(decoded)
  })
}

export function discoverHostUiDocs(input?: unknown) {
  return discoverHostUiDocsWith(input, listDocsDiscoveryView)
}
