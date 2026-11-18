import type { ShortcutBinding } from '@shared/types/shortcuts'
import { useState } from 'react'
import { useUIStore } from '@/shell/ui-store'
import {
  type PanelShortcutRow,
  panelCommandRulesWithBinding,
  panelCommandRulesWithoutCommand,
} from '../lib/panel-shortcut-model'
import { usePreferencesStore } from '../state'

/** Saves one Panels row: built-in commands as Shortcut registry rules, extension panels by id. */
export function usePanelShortcutSaving(onError: (message: string | null) => void) {
  const rules = usePreferencesStore((state) => state.settings.shortcutRules)
  const setShortcutRules = usePreferencesStore((state) => state.setShortcutRules)
  const setExtensionPanelShortcutBinding = usePreferencesStore(
    (state) => state.setExtensionPanelShortcutBinding,
  )
  const showToast = useUIStore((state) => state.showToast)
  const [saving, setSaving] = useState(false)

  async function run(write: () => Promise<void>) {
    setSaving(true)
    try {
      await write()
      onError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save shortcut.'
      onError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return {
    saving,
    save: (row: PanelShortcutRow, binding: ShortcutBinding | null) =>
      run(() => {
        if (row.kind === 'extension-panel') {
          return setExtensionPanelShortcutBinding(row.surfaceId, binding)
        }
        return setShortcutRules(
          binding === null
            ? panelCommandRulesWithoutCommand(rules, row.command)
            : panelCommandRulesWithBinding(rules, row.command, binding),
        )
      }),
    reset: (row: PanelShortcutRow) =>
      run(() =>
        row.kind === 'command'
          ? setShortcutRules(panelCommandRulesWithoutCommand(rules, row.command))
          : setExtensionPanelShortcutBinding(row.surfaceId, null),
      ),
  }
}
