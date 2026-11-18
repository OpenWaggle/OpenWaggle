import { FolderPlus, Trash2 } from 'lucide-react'
import { parseModelRef, type ProviderInfo } from '@shared/types/llm'
import { useState } from 'react'
import {
  PROVIDER_RESTRICTION_ONLY_KEY,
  type ProviderRestrictionScope,
  resolveProviderRestriction,
} from '@shared/utils/provider-restriction'
import { useProviders } from '@/features/settings/hooks/useSettings'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

/**
 * One scope row set per provider: Inherited (unmentioned, the next scope decides), Allowed, or
 * Blocked. Editing a scope that carries `only` edits the list: Allowed adds to it, anything else
 * removes. The toggle states the closure plainly: on, the scope permits only the providers turned
 * on here.
 */
type ProviderChoice = 'inherited' | 'allowed' | 'blocked'

function providerChoiceOf(raw: string) {
  return raw === 'allowed' || raw === 'blocked' ? raw : 'inherited'
}

/** The scope's `only` list, with non-string entries dropped, or an empty list when it has none. */
function onlyListOf(scope: ProviderRestrictionScope) {
  const only = scope[PROVIDER_RESTRICTION_ONLY_KEY]
  return Array.isArray(only) ? only.filter((id): id is string => typeof id === 'string') : []
}

function choiceOf(scope: ProviderRestrictionScope, provider: string) {
  if (Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])) {
    return onlyListOf(scope).includes(provider) ? 'allowed' : 'blocked'
  }
  const choice = scope[provider]
  if (choice === true) return 'allowed'
  if (choice === false) return 'blocked'
  return 'inherited'
}

function withChoice(scope: ProviderRestrictionScope, provider: string, choice: ProviderChoice) {
  if (Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])) {
    const only = onlyListOf(scope)
    const next =
      choice === 'allowed'
        ? [...new Set([...only, provider])]
        : only.filter((id) => id !== provider)
    return { ...scope, [PROVIDER_RESTRICTION_ONLY_KEY]: next }
  }
  const { [provider]: _removed, ...rest } = scope
  if (choice === 'inherited') return rest
  return { ...rest, [provider]: choice === 'allowed' }
}

function withOnly(scope: ProviderRestrictionScope, only: boolean) {
  const { [PROVIDER_RESTRICTION_ONLY_KEY]: _removed, ...rest } = scope
  if (!only) return rest
  const allowed = Object.entries(rest)
    .filter(([, value]) => value === true)
    .map(([provider]) => provider)
  return { ...rest, [PROVIDER_RESTRICTION_ONLY_KEY]: allowed }
}

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

interface ScopeEffect {
  /** The restriction a project at this scope resolves, with every configured scope applying. */
  readonly restriction: ReturnType<typeof resolveProviderRestriction>
  /** Enabled catalog-listed models that restriction leaves. */
  readonly enabledWithin: number
  readonly anyEnabled: boolean
}

interface ScopeEditorProps {
  readonly label: string
  readonly scope: ProviderRestrictionScope
  readonly providerModels: readonly ProviderInfo[]
  readonly effect: ScopeEffect
  readonly error: string | null
  readonly onChange: (next: ProviderRestrictionScope) => void
  readonly onRemove?: () => void
}

function ScopeEditor({
  label,
  scope,
  providerModels,
  effect,
  error,
  onChange,
  onRemove,
}: ScopeEditorProps) {
  const only = Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])
  const warns = effect.anyEnabled && providerModels.length > 0 && effect.enabledWithin === 0
  return (
    <div className="rounded-lg border border-border bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text-primary">{label}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Covers every project inside. A deeper scope overrides each provider it names.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ToggleSwitch
            checked={only}
            onCheckedChange={(next) => onChange(withOnly(scope, next))}
            label={`Restrict ${label} to only the providers allowed here`}
          />
          {onRemove ? (
            <Button
              variant="secondary"
              className="px-2"
              aria-label={`Remove provider scope ${label}`}
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="divide-y divide-border">
        {providerModels.map((group) => {
          const choice = choiceOf(scope, group.provider)
          return (
            <div key={group.provider} className="flex items-center justify-between gap-4 px-4 py-2">
              <span className="min-w-0 truncate text-xs text-text-primary">
                {group.displayName}
              </span>
              <Select
                value={choice}
                onChange={(event) =>
                  onChange(withChoice(scope, group.provider, providerChoiceOf(event.target.value)))
                }
                aria-label={`${group.displayName} in ${label}`}
                className="w-32"
              >
                <option value="inherited">Inherited</option>
                <option value="allowed">Allowed</option>
                <option value="blocked">Blocked</option>
              </Select>
            </div>
          )
        })}
        {providerModels.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-muted">Loading providers…</p>
        ) : null}
      </div>
      {warns ? (
        <p className="border-t border-border px-4 py-2 text-xs text-warning-text">
          No enabled model for the providers this scope allows. Enable one in Available Models, or
          widen the scope.
        </p>
      ) : null}
      {error ? <p className="px-4 py-2 text-xs text-error-text">{error}</p> : null}
    </div>
  )
}

/**
 * Which Pi providers each project's Sessions may use, set at scopes from the whole app down to one
 * folder (CONTEXT.md, "Provider restriction"). The nearest scope that mentions a provider decides
 * it; a scope turned on to "only" refuses every provider it does not name.
 */
export function ProviderRestrictionsSection() {
  const settings = usePreferencesStore((state) => state.settings)
  const { providerModels } = useProviders()
  const [error, setError] = useState<string | null>(null)
  const [scopeErrors, setScopeErrors] = useState<Record<string, string>>({})

  async function apply(patch: {
    providerRestrictions?: Record<string, boolean | readonly string[]>
    providerRestrictionsByPath?: Record<string, Record<string, boolean | readonly string[]>>
  }) {
    const result = await api.updateSettings(patch)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, ...patch },
    }))
    return true
  }

  async function addScope() {
    const picked = await api.selectProjectFolder()
    if (!picked) return
    const result = await apply({
      providerRestrictionsByPath: {
        ...settings.providerRestrictionsByPath,
        [picked]: {},
      },
    })
    if (!result) setScopeErrors((errors) => ({ ...errors, [picked]: error ?? '' }))
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
        error={error}
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
          error={scopeErrors[scopePath] ?? null}
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
