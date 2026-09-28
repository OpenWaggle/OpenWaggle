import type {
  ActionCatalog,
  ActionManifest,
  PreparationDefinition,
  PreparationReview,
} from '@shared/types/action-definitions'
import {
  preparationExecutionKey,
  preparationReview,
  reviewProfileContext,
} from './preparation-review-context'

interface SaverEnablementInput {
  /** The catalog before the save, to see what the slot held and whether it awaited review. */
  readonly before: ActionCatalog
  readonly document: {
    readonly manifest: ActionManifest
    readonly reviews: readonly PreparationReview[]
  }
  readonly shared: ActionManifest
  readonly definition: PreparationDefinition
}

/**
 * Saving a preparation counts as the saver's review of precisely this execution, in either
 * storage (ADR 0038). It never trusts later edits, and other users still review a shared
 * definition. A save identical to a pending change someone else made is not a review: re-saving
 * it unread must not turn it on, so that execution keeps requiring an explicit decision.
 */
export function withSaverEnablement<T extends SaverEnablementInput['document']>(
  input: SaverEnablementInput & { readonly document: T },
): T {
  const { definition } = input
  const pending = input.before.preparation.find(
    ({ definition: entry }) =>
      entry.profileId === definition.profileId && entry.phase === definition.phase,
  )
  const unreadPendingChange =
    pending?.review === 'required' &&
    preparationExecutionKey(pending.definition) === preparationExecutionKey(definition)
  if (unreadPendingChange) return input.document
  const profileName = reviewProfileContext(definition.profileId, [
    ...input.document.manifest.profiles,
    ...input.shared.profiles,
  ]).profileName
  return {
    ...input.document,
    reviews: [
      ...input.document.reviews.filter((review) => review.definitionId !== definition.id),
      preparationReview(definition, true, profileName),
    ],
  }
}
