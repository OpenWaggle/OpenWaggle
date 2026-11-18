import type { ActionDefinition, EffectiveDefinition } from '@shared/types/action-definitions'
import { actionNameKey } from '@shared/utils/action-name'
import { packageLabel } from './action-panel-scripts'

/** Name keys used by more than one effective action; they keep working but need telling apart. */
export function duplicateActionNames(actions: readonly EffectiveDefinition<ActionDefinition>[]) {
  const counts = new Map<string, number>()
  for (const { definition } of actions) {
    const key = actionNameKey(definition.name)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key))
}

/** A grey hint that tells two same-named actions apart: package folder, or who has it. */
export function duplicateNameHint(entry: EffectiveDefinition<ActionDefinition>) {
  const invocation = entry.definition.invocation
  const folder =
    invocation.type === 'task'
      ? packageLabel(invocation.task)
      : invocation.directory === '.'
        ? null
        : invocation.directory
  if (folder) return folder
  return entry.source === 'local' ? 'only you' : 'shared'
}
