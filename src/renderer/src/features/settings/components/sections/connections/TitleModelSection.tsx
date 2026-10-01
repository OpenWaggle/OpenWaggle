import {
  parseSessionTitleModelSetting,
  SESSION_TITLE_MODEL_AUTOMATIC,
  SESSION_TITLE_MODEL_OFF,
  type SessionTitleModelSetting,
} from '@shared/session-title-model'
import type { ProviderInfo } from '@shared/types/llm'
import { useState } from 'react'
import { useProviders } from '@/features/settings/hooks/useSettings'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { Select } from '@/shared/ui/Select'

const logger = createRendererLogger('settings')

const SELECT_ID = 'session-title-model'

export const TitleModelCopy = {
  automaticHelp: "Uses the cheapest available model from each session's own provider.",
  offHelp: 'Sessions keep their first message as the title.',
  selectedModelNote:
    "Each session's first message and Worker objectives are sent to this model's provider to generate titles.",
} as const

interface TitleModelOption {
  readonly value: string
  readonly label: string
}

/** Enabled models grouped by provider, labelled by display name; unknown refs keep their id. */
function buildTitleModelGroups(
  enabledModels: readonly string[],
  providerModels: readonly ProviderInfo[],
  selected: SessionTitleModelSetting,
) {
  const lookup = new Map<string, { readonly name: string; readonly providerName: string }>()
  for (const provider of providerModels) {
    for (const model of provider.models) {
      lookup.set(model.id, {
        name: model.name.trim() || model.modelId,
        providerName: provider.displayName,
      })
    }
  }

  const refs = [...new Set(enabledModels.map((ref) => ref.trim()).filter(Boolean))]
  const isSpecific =
    selected !== SESSION_TITLE_MODEL_AUTOMATIC && selected !== SESSION_TITLE_MODEL_OFF
  // A selected model the user later disabled stays visible, so the control shows the real setting.
  if (isSpecific && !refs.includes(selected)) refs.push(selected)

  const groups = new Map<string, TitleModelOption[]>()
  for (const ref of refs) {
    const info = lookup.get(ref)
    const groupLabel = info?.providerName ?? 'Other models'
    const options = groups.get(groupLabel) ?? []
    options.push({ value: ref, label: info?.name ?? ref })
    groups.set(groupLabel, options)
  }
  return [...groups].map(([label, options]) => ({ label, options }))
}

function titleModelHelp(selected: SessionTitleModelSetting) {
  if (selected === SESSION_TITLE_MODEL_AUTOMATIC) return TitleModelCopy.automaticHelp
  if (selected === SESSION_TITLE_MODEL_OFF) return TitleModelCopy.offHelp
  return null
}

/** The Title model setting: which model names Sessions, or Off. */
export function TitleModelSection() {
  const selected = usePreferencesStore((state) => state.settings.sessionTitleModel)
  const enabledModels = usePreferencesStore((state) => state.settings.enabledModels)
  const setSessionTitleModel = usePreferencesStore((state) => state.setSessionTitleModel)
  const { providerModels } = useProviders()
  const [saving, setSaving] = useState(false)
  const groups = buildTitleModelGroups(enabledModels, providerModels, selected)
  const help = titleModelHelp(selected)

  function choose(raw: string) {
    const next = parseSessionTitleModelSetting(raw)
    if (next === null || next === selected || saving) return
    setSaving(true)
    void setSessionTitleModel(next)
      .catch((error: unknown) => {
        logger.warn('Failed to update title model', { error: String(error) })
      })
      .finally(() => setSaving(false))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-text-primary">Session titles</h3>
        <p className="text-xs text-text-tertiary">
          Choose the model that names new sessions in the background.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-bg px-5 py-3">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <label htmlFor={SELECT_ID} className="text-xs font-medium text-text-primary">
            Title model
          </label>
          <Select
            id={SELECT_ID}
            value={selected}
            disabled={saving}
            className="max-w-72 min-w-44"
            onChange={(event) => choose(event.target.value)}
          >
            <option value={SESSION_TITLE_MODEL_AUTOMATIC}>Automatic</option>
            <option value={SESSION_TITLE_MODEL_OFF}>Off</option>
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        {help ? (
          <p className="mt-2 text-xs text-text-tertiary">{help}</p>
        ) : (
          <p role="note" className="mt-2 text-xs text-text-secondary">
            {TitleModelCopy.selectedModelNote}
          </p>
        )}
      </div>
    </div>
  )
}
