import {
  PROJECT_ACTION_LIMITS,
  type ProjectActionShortcutRule,
} from '@shared/types/project-actions'
import {
  DEFAULT_SHORTCUT_RULES,
  SHORTCUT_RULE_LIMITS,
  type ShortcutRule,
  type ShortcutRules,
} from '@shared/types/shortcuts'
import { removeShortcutRule, upsertShortcutRule } from '@shared/utils/shortcut-rules'
import { useState } from 'react'
import { useProjectActionMutations, useProjectActions } from '@/features/project-actions'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import {
  buildShortcutBrowserRows,
  projectActionBindingCount,
} from '../../lib/shortcut-browser-model'
import { ShortcutsSectionContent } from './ShortcutsSectionContent'

export function ShortcutsSection() {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const shortcutRules = usePreferencesStore((state) => state.settings.shortcutRules)
  const setShortcutRules = usePreferencesStore((state) => state.setShortcutRules)
  const showToast = useUIStore((state) => state.showToast)
  const actionsQuery = useProjectActions(projectPath)
  const mutations = useProjectActionMutations(projectPath)
  const actions = actionsQuery.data ?? []
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [savingBuiltIns, setSavingBuiltIns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = buildShortcutBrowserRows(shortcutRules, actions)
  const visibleRows = buildShortcutBrowserRows(shortcutRules, actions, query)
  const projectBindings = projectActionBindingCount(actions)
  const builtInAtLimit = shortcutRules.length >= SHORTCUT_RULE_LIMITS.RULES
  const projectAtLimit = projectBindings >= PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT
  const saving = savingBuiltIns || mutations.isSaving

  async function persistBuiltInRules(nextRules: ShortcutRules) {
    setSavingBuiltIns(true)
    try {
      await setShortcutRules(nextRules)
      setError(null)
      return true
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save binding.'
      setError(message)
      showToast(message, 'error')
      return false
    } finally {
      setSavingBuiltIns(false)
    }
  }

  async function updateProjectRules(
    actionId: string,
    nextRules: readonly ProjectActionShortcutRule[],
  ) {
    try {
      await mutations.update(actionId, { shortcutRules: nextRules })
      setError(null)
      return true
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Could not save Project Action binding.'
      setError(message)
      showToast(message, 'error')
      return false
    }
  }

  async function addBuiltInRule(rule: ShortcutRule) {
    if (builtInAtLimit) {
      setError(`Built-in shortcuts may have at most ${String(SHORTCUT_RULE_LIMITS.RULES)} rules.`)
      return false
    }
    return persistBuiltInRules(upsertShortcutRule(shortcutRules, rule))
  }

  const canAdd = !builtInAtLimit || (projectPath !== null && actions.length > 0 && !projectAtLimit)

  return (
    <ShortcutsSectionContent
      model={{
        actions,
        rows,
        visibleRows,
        query,
        adding,
        canAdd,
        saving,
        error,
        projectError: actionsQuery.isError ? actionsQuery.error.message : null,
        builtInCount: visibleRows.filter((row) => row.kind === 'builtin').length,
        projectCount: visibleRows.filter((row) => row.kind === 'project').length,
      }}
      actions={{
        onSearch: setQuery,
        onAddStart: () => setAdding(true),
        onAddClose: () => setAdding(false),
        onReset: () => void persistBuiltInRules(DEFAULT_SHORTCUT_RULES),
        onError: setError,
        onBuiltInAdd: addBuiltInRule,
        onBuiltInRemove: (rule) => persistBuiltInRules(removeShortcutRule(shortcutRules, rule)),
        onBuiltInUpsert: (next, replace) =>
          persistBuiltInRules(upsertShortcutRule(shortcutRules, next, replace)),
        onProjectUpdate: updateProjectRules,
      }}
    />
  )
}
