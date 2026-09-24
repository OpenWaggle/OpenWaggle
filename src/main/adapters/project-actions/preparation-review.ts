import type { PreparationDefinition } from '@shared/types/action-definitions'
import * as Effect from 'effect/Effect'
import { preparationReview, reviewProfileContext } from '../../domain/preparation-review-context'
import { preparationExecutionKey } from '../../domain/project-action-catalog'
import type { ActionCatalogServiceShape } from '../../ports/action-catalog-service'
import type { ActionRunWorkspace } from '../../ports/action-run-service'

/** A pinned old snapshot approval must never enable a different current definition. */
export function rememberPreparationReview(
  catalog: ActionCatalogServiceShape,
  workspace: ActionRunWorkspace,
  definition: PreparationDefinition,
  enabled: boolean,
) {
  return Effect.gen(function* () {
    const current = yield* catalog.read(workspace).pipe(Effect.catchAll(() => Effect.succeed(null)))
    const entry = current?.preparation.find((entry) => entry.definition.id === definition.id)
    if (
      !current ||
      !entry ||
      entry.definition.profileId !== definition.profileId ||
      preparationExecutionKey(entry.definition) !== preparationExecutionKey(definition)
    )
      return
    if (entry.review === (enabled ? 'enabled' : 'disabled')) return
    const granted = preparationReview(
      definition,
      enabled,
      reviewProfileContext(
        definition.profileId,
        current.profiles.map(({ definition: profile }) => profile),
      ).profileName,
    )
    yield* catalog.edit(workspace, current.revision, {
      type: 'review-preparation',
      id: definition.id,
      enabled,
    })
    return async () => {
      await Effect.runPromise(catalog.restorePreparationReview(workspace, granted, entry.previous))
    }
  })
}
