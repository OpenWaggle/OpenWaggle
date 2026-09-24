import type { EffectiveDefinition, PreparationDefinition } from '@shared/types/action-definitions'

export function effective<T extends { readonly id: string }>(
  local: readonly T[],
  shared: readonly T[],
): EffectiveDefinition<T>[] {
  const personal = new Map(local.map((definition) => [definition.id, definition]))
  return [
    ...shared.map(
      (definition): EffectiveDefinition<T> => ({
        definition: personal.get(definition.id) ?? definition,
        source: personal.has(definition.id) ? 'override' : 'project',
      }),
    ),
    ...local
      .filter((definition) => !shared.some((entry) => entry.id === definition.id))
      .map((definition): EffectiveDefinition<T> => ({ definition, source: 'local' })),
  ]
}

/** Preparation has one slot per profile/phase, even when peers created independent IDs. */
export function effectivePreparation(
  local: readonly PreparationDefinition[],
  shared: readonly PreparationDefinition[],
) {
  const sameSlot = (left: PreparationDefinition, right: PreparationDefinition) =>
    left.profileId === right.profileId && left.phase === right.phase
  return effective(local, shared).flatMap((entry): EffectiveDefinition<PreparationDefinition>[] => {
    if (entry.source === 'project' && local.some((item) => sameSlot(item, entry.definition)))
      return []
    if (entry.source === 'local' && shared.some((item) => sameSlot(item, entry.definition)))
      return [{ ...entry, source: 'override' }]
    return [entry]
  })
}

/** Explicit saves and moves replace the destination's one profile/phase slot. */
export function upsertPreparation(
  entries: readonly PreparationDefinition[],
  definition: PreparationDefinition,
) {
  return [
    ...entries.filter(
      (entry) =>
        entry.id !== definition.id &&
        (entry.profileId !== definition.profileId || entry.phase !== definition.phase),
    ),
    definition,
  ]
}
