import { safeDecodeUnknown } from '@shared/schema'
import { docsResolveTopicInputSchema } from '@shared/schemas/docs'
import type { DocsResolveTopicInput, FirstPartyDocsTopicSummary } from '@shared/types/docs'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { resolveDocsTopic } from '../application/docs-discovery-service'
import type { GuiServices } from '../gui-runtime'
import { hostHandle, typedHandle } from './typed-ipc'

export interface RegisterDocsHandlersDependencies {
  readonly resolveTopic?: (
    input: DocsResolveTopicInput,
  ) => EffectType<FirstPartyDocsTopicSummary | null, unknown, GuiServices>
}

function decodeResolveTopicInput(value: unknown) {
  const decoded = safeDecodeUnknown(docsResolveTopicInputSchema, value)
  if (!decoded.success) {
    return Effect.fail(new Error(decoded.issues.join('; ')))
  }
  return Effect.succeed(decoded.data)
}

export function registerDocsHandlers(dependencies: RegisterDocsHandlersDependencies = {}): void {
  const resolveTopic = dependencies.resolveTopic ?? resolveDocsTopic

  hostHandle('docs:discover')

  typedHandle('docs:resolve-topic', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeResolveTopicInput(input)
      return yield* resolveTopic(decoded)
    }),
  )
}
