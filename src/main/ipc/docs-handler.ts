import { type Schema, safeDecodeUnknown } from '@shared/schema'
import { docsListInputSchema, docsResolveTopicInputSchema } from '@shared/schemas/docs'
import type {
  DocsDiscoveryView,
  DocsListInput,
  DocsResolveTopicInput,
  FirstPartyDocsTopicSummary,
} from '@shared/types/docs'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { listDocsDiscoveryView, resolveDocsTopic } from '../application/docs-discovery-service'
import type { AppServices } from '../runtime'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export interface RegisterDocsHandlersDependencies {
  readonly listDocs?: (input: DocsListInput) => EffectType<DocsDiscoveryView, unknown, AppServices>
  readonly resolveTopic?: (
    input: DocsResolveTopicInput,
  ) => EffectType<FirstPartyDocsTopicSummary | null, unknown, AppServices>
}

function decodeSchema<A, I>(schema: Schema.Schema<A, I, never>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) {
    return Effect.fail(new Error(decoded.issues.join('; ')))
  }
  return Effect.succeed(decoded.data)
}

function dedupeProjectPaths(projectPaths: readonly string[]) {
  const deduped: string[] = []
  for (const projectPath of projectPaths) {
    if (!deduped.includes(projectPath)) {
      deduped.push(projectPath)
    }
  }
  return deduped
}

function validateProjectPaths(
  projectPaths: readonly string[] | undefined,
): Effect.Effect<readonly string[], Error> {
  if (!projectPaths) {
    return Effect.succeed([])
  }

  return Effect.forEach(projectPaths, validateRequiredProjectPath).pipe(
    Effect.map(dedupeProjectPaths),
  )
}

function decodeListInput(raw: unknown): Effect.Effect<DocsListInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) {
      return { projectPaths: [] }
    }

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

export function registerDocsHandlers(dependencies: RegisterDocsHandlersDependencies = {}): void {
  const listDocs = dependencies.listDocs ?? listDocsDiscoveryView
  const resolveTopic = dependencies.resolveTopic ?? resolveDocsTopic

  typedHandle('docs:discover', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListInput(input)
      return yield* listDocs(decoded)
    }),
  )

  typedHandle('docs:resolve-topic', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeSchema(docsResolveTopicInputSchema, input)
      return yield* resolveTopic(decoded)
    }),
  )
}
