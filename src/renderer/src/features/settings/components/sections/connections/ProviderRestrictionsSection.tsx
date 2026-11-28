import { FolderPlus } from 'lucide-react'
import { parseModelRef, type ProviderInfo } from '@shared/types/llm'
import { useState } from 'react'
import { resolveProviderRestriction } from '@shared/utils/provider-restriction'
import { useProviders } from '@/features/settings/hooks/useSettings'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'

import { ScopeEditor } from './ProviderScopeEditor'

/**
 * How many enabled, catalog-listed models a restriction leaves. Zero warns while the scope is
 * being configured, instead of refusing a launch later (CONTEXT.md, "Provider restriction").
 */
function enabledModelCountWithinRestriction(
  enabledModels: readonly string[],
  providerModels: readonly ProviderInfo[],
  restriction: ReturnType<typeof resolveProviderRestriction>,
) {
  const catalogIds = new Set(
    providerModels.flatMap((group) => group.models.map((m) => String(m.id))),
  )
  return enabledModels.filter((model) => {
    const parsed = parseModelRef(model)
    return parsed !== null && restriction.allows(parsed.provider) && catalogIds.has(model)
  }).length
}

/** A path no configured scope can contain, so the restriction resolved for it is app-wide only. */
const APP_WIDE_PROBE_PATH = '/openwaggle-app-wide-provider-restriction-probe'

/**
 * Which Pi providers each project's Sessions may use, set at scopes from the whole app down to one
 * folder (CONTEXT.md, "Provider restriction"). The nearest scope that mentions a provider decides
 * it; a scope turned on to "only" refuses every provider it does not name.
 */
export function ProviderRestrictionsSection() {
  const settings = usePreferencesStore((state) => state.settings)
  const { providerModels } = useProviders()
  const [error, setError] = useState<string | null>(null)

  async function apply(patch: {
    providerRestrictions?: Record<string, boolean | readonly string[]>
    providerRestrictionsByPath?: Record<string, Record<string, boolean | readonly string[]>>
  }) {
    const result = await api.updateSettings(patch)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, ...patch },
    }))
  }

  async function addScope() {
    const picked = await api.selectProjectFolder()
    if (!picked) return
    // A refused folder never joins the list, so its reason shows with the section's error.
    await apply({
      providerRestrictionsByPath: {
        ...settings.providerRestrictionsByPath,
        [picked]: {},
      },
    })
  }

  async function removeScope(scopePath: string) {
    const { [scopePath]: _removed, ...rest } = settings.providerRestrictionsByPath
    await apply({ providerRestrictionsByPath: rest })
  }

  const scopePaths = Object.keys(settings.providerRestrictionsByPath).sort()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-text-primary">Provider Restrictions</h3>
          <p className="max-w-180 text-xs leading-5 text-text-tertiary">
            Choose which providers each project's sessions may use. The nearest scope that names a
            provider decides it; a scope restricted to “only” permits just the providers allowed
            there. A request naming any other provider is refused.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void addScope()}>
          <FolderPlus className="size-3.5" />
          Add folder scope
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error-text">
          {error}
        </p>
      ) : null}

      <ScopeEditor
        label="Every project (app-wide)"
        scope={settings.providerRestrictions}
        providerModels={providerModels}
        effect={{
          restriction: resolveProviderRestriction({
            projectPath: APP_WIDE_PROBE_PATH,
            appWide: settings.providerRestrictions,
          }),
          enabledWithin: enabledModelCountWithinRestriction(
            settings.enabledModels,
            providerModels,
            resolveProviderRestriction({
              projectPath: APP_WIDE_PROBE_PATH,
              appWide: settings.providerRestrictions,
            }),
          ),
          anyEnabled: settings.enabledModels.length > 0,
        }}
        onChange={(next) => void apply({ providerRestrictions: next })}
      />

      {scopePaths.map((scopePath) => (
        <ScopeEditor
          key={scopePath}
          label={scopePath}
          scope={settings.providerRestrictionsByPath[scopePath] ?? {}}
          providerModels={providerModels}
          effect={{
            restriction: resolveProviderRestriction({
              projectPath: scopePath,
              byPath: settings.providerRestrictionsByPath,
              appWide: settings.providerRestrictions,
            }),
            enabledWithin: enabledModelCountWithinRestriction(
              settings.enabledModels,
              providerModels,
              resolveProviderRestriction({
                projectPath: scopePath,
                byPath: settings.providerRestrictionsByPath,
                appWide: settings.providerRestrictions,
              }),
            ),
            anyEnabled: settings.enabledModels.length > 0,
          }}
          onChange={(next) =>
            void apply({
              providerRestrictionsByPath: {
                ...settings.providerRestrictionsByPath,
                [scopePath]: next,
              },
            })
          }
          onRemove={() => void removeScope(scopePath)}
        />
      ))}

      <p className="text-xs text-text-tertiary">
        A project can also carry its own restriction in its{' '}
        <code className="text-text-secondary">.openwaggle/settings.json</code> under{' '}
        <code className="text-text-secondary">providers</code>, which outranks every scope here.
      </p>
    </div>
  )
}
