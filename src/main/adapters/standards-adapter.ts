/**
 * FilesystemStandardsLive — adapter implementing StandardsService via filesystem.
 *
 * Delegates to the existing `loadAgentStandardsContext` function,
 * wrapping it in Effect error handling with `StandardsLoadError`.
 */
import { Effect, Layer } from 'effect'
import { StandardsLoadError } from '../errors'
import { StandardsService } from '../ports/standards-service'

export const FilesystemStandardsLive = Effect.promise(async () => {
  const { loadAgentStandardsContext } = await import('../agent/standards-context')
  return Layer.succeed(
    StandardsService,
    StandardsService.of({
      loadContext: (options) =>
        Effect.tryPromise({
          try: () =>
            loadAgentStandardsContext(
              options.projectPath,
              options.userText,
              options.settings,
              options.attachments,
            ),
          catch: (cause) =>
            new StandardsLoadError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    }),
  )
}).pipe(Layer.unwrapEffect)
