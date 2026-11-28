import { ChevronRight, Trash2 } from 'lucide-react'
import type { ProviderInfo } from '@shared/types/llm'
import { useId, useState } from 'react'
import {
  PROVIDER_RESTRICTION_ONLY_KEY,
  type ProviderRestrictionScope,
  type ResolvedProviderRestriction,
} from '@shared/utils/provider-restriction'
import { cn } from '@/shared/lib/cn'
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

/**
 * Turning `only` on starts the list as what the scope resolves to now, its own choices over what
 * it inherits, so closing a scope refuses nothing until a provider is blocked in it. Starting from
 * the scope's explicit grants alone would close an untouched scope to no provider at all.
 */
function withOnly(scope: ProviderRestrictionScope, only: boolean, allowedNow: readonly string[]) {
  const { [PROVIDER_RESTRICTION_ONLY_KEY]: _removed, ...rest } = scope
  if (!only) return rest
  return { ...rest, [PROVIDER_RESTRICTION_ONLY_KEY]: [...allowedNow] }
}

/** A provider's name as its Settings row shows it, or its id when the catalog lacks it. */
function providerName(providerModels: readonly ProviderInfo[], provider: string) {
  return providerModels.find((group) => group.provider === provider)?.displayName ?? provider
}

/** What a scope says, in one line, so a collapsed scope still reads at a glance. */
function scopeSummary(scope: ProviderRestrictionScope, providerModels: readonly ProviderInfo[]) {
  const names = (providers: readonly string[]) =>
    providers.map((provider) => providerName(providerModels, provider)).join(', ')
  if (Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])) {
    const only = onlyListOf(scope)
    return only.length > 0 ? `Only ${names(only)}` : 'Only: no provider'
  }
  const choices = Object.entries(scope)
  const allowed = choices.filter(([, value]) => value === true).map(([provider]) => provider)
  const blocked = choices.filter(([, value]) => value === false).map(([provider]) => provider)
  const parts = [
    ...(allowed.length > 0 ? [`Allowed: ${names(allowed)}`] : []),
    ...(blocked.length > 0 ? [`Blocked: ${names(blocked)}`] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : 'No providers set'
}

interface ScopeEffect {
  /** The restriction a project at this scope resolves, with every configured scope applying. */
  readonly restriction: ResolvedProviderRestriction
  /** Enabled catalog-listed models that restriction leaves. */
  readonly enabledWithin: number
  readonly anyEnabled: boolean
}

interface ScopeEditorProps {
  readonly label: string
  readonly scope: ProviderRestrictionScope
  readonly providerModels: readonly ProviderInfo[]
  readonly effect: ScopeEffect
  readonly onChange: (next: ProviderRestrictionScope) => void
  readonly onRemove?: () => void
}

/**
 * One scope, collapsible so a long list of folders stays navigable. Its header always shows what
 * the scope says; a scope that sets nothing yet, such as a folder just added, starts open so it
 * can be configured at once.
 */
export function ScopeEditor({
  label,
  scope,
  providerModels,
  effect,
  onChange,
  onRemove,
}: ScopeEditorProps) {
  const only = Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])
  const warns = effect.anyEnabled && providerModels.length > 0 && effect.enabledWithin === 0
  const [open, setOpen] = useState(() => Object.keys(scope).length === 0)
  const bodyId = useId()
  return (
    <div className="rounded-lg border border-border bg-bg">
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3',
          open && 'border-b border-border',
        )}
      >
        <Button
          variant="unstyled"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'mt-0.5 size-3.5 shrink-0 text-text-tertiary transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-text-primary">{label}</span>
            <span className="mt-0.5 block truncate text-xs text-text-tertiary">
              {scopeSummary(scope, providerModels)}
            </span>
          </span>
        </Button>
        <div className="flex shrink-0 items-center gap-3">
          {/* The switch names itself for assistive technology; this is its visible label. */}
          <span aria-hidden="true" className="text-xs text-text-tertiary">
            Only allowed providers
          </span>
          <ToggleSwitch
            checked={only}
            onCheckedChange={(next) =>
              onChange(
                withOnly(
                  scope,
                  next,
                  providerModels
                    .map((group) => group.provider)
                    .filter((provider) => effect.restriction.allows(provider)),
                ),
              )
            }
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
      {/* Always rendered, so the toggle's aria-controls names an element that exists. */}
      <div id={bodyId} hidden={!open}>
        {open ? <ScopeEditorBody {...{ label, scope, providerModels, onChange }} /> : null}
      </div>
      {warns ? (
        <p className="border-t border-border px-4 py-2 text-xs text-warning-text">
          No enabled model for the providers this scope allows. Enable one in Available Models, or
          widen the scope.
        </p>
      ) : null}
    </div>
  )
}

interface ScopeEditorBodyProps {
  readonly label: string
  readonly scope: ProviderRestrictionScope
  readonly providerModels: readonly ProviderInfo[]
  readonly onChange: (next: ProviderRestrictionScope) => void
}

function ScopeEditorBody({ label, scope, providerModels, onChange }: ScopeEditorBodyProps) {
  const only = Array.isArray(scope[PROVIDER_RESTRICTION_ONLY_KEY])
  return (
    <>
      <p className="px-4 pt-3 text-xs text-text-tertiary">
        Covers every project inside. A deeper scope overrides each provider it names.
      </p>
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
                {/* A scope closed to its only list inherits nothing: each provider is in it or not. */}
                {only ? null : <option value="inherited">Inherited</option>}
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
    </>
  )
}
