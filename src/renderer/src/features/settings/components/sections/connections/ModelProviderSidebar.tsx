import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ModelGroup } from '@/features/providers/model'
import {
  ALL_PROVIDERS,
  type ProviderScope,
  providerScope,
  scopedProvider,
} from '@/features/settings/lib/available-models-filter'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { getProviderMeta } from './meta'

interface ModelProviderSidebarProps {
  readonly groups: readonly ModelGroup[]
  readonly scope: ProviderScope
  readonly matches: ReadonlyMap<Provider, readonly ModelDisplayInfo[]>
  readonly queryActive: boolean
  readonly enabledSet: ReadonlySet<string>
  readonly onSelectScope: (scope: ProviderScope) => void
}

interface SidebarItemProps {
  readonly icon: ReactNode
  readonly label: string
  readonly isActive: boolean
  readonly dimmed: boolean
  readonly status?: { readonly connected: boolean }
  readonly count: ReactNode
  readonly onSelect: () => void
}

function SidebarItem({ icon, label, isActive, dimmed, status, count, onSelect }: SidebarItemProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-pressed={isActive}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
        isActive
          ? 'bg-accent/15 text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        dimmed && !isActive && 'opacity-50',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {status && (
        <span
          role="img"
          aria-label={status.connected ? 'Ready to use' : 'Auth required'}
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            status.connected ? 'bg-success' : 'bg-text-muted',
          )}
        />
      )}
      <span className="shrink-0 text-text-muted tabular-nums">{count}</span>
    </Button>
  )
}

function countLabel(
  models: readonly ModelDisplayInfo[],
  hits: number,
  queryActive: boolean,
  enabledSet: ReadonlySet<string>,
): ReactNode {
  if (queryActive) return <span className={cn(hits > 0 && 'text-accent')}>{hits}</span>
  const selected = models.filter((model) => enabledSet.has(model.id)).length
  return `${String(selected)}/${String(models.length)}`
}

export function ModelProviderSidebar({
  groups,
  scope,
  matches,
  queryActive,
  enabledSet,
  onSelectScope,
}: ModelProviderSidebarProps) {
  const allModels = groups.flatMap((group) => group.models)
  const allHits = [...matches.values()].reduce((total, models) => total + models.length, 0)

  return (
    <nav
      aria-label="Providers"
      className="flex shrink-0 flex-col gap-px overflow-y-auto max-sm:max-h-60 border-border border-b bg-bg-secondary p-1.5 sm:w-52 sm:border-r sm:border-b-0"
    >
      <SidebarItem
        icon={<Layers className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />}
        label="All providers"
        isActive={scope.kind === 'all'}
        dimmed={queryActive && allHits === 0}
        count={countLabel(allModels, allHits, queryActive, enabledSet)}
        onSelect={() => onSelectScope(ALL_PROVIDERS)}
      />
      {groups.map((group) => {
        const meta = getProviderMeta(group.provider)
        const Icon = meta.icon
        const hits = matches.get(group.provider)?.length ?? 0
        return (
          <SidebarItem
            key={group.key}
            icon={<Icon className={cn('size-4 shrink-0', meta.iconClassName)} />}
            label={group.label}
            isActive={scopedProvider(scope) === group.provider}
            dimmed={queryActive && hits === 0}
            status={{ connected: group.connected }}
            count={countLabel(group.models, hits, queryActive, enabledSet)}
            onSelect={() => onSelectScope(providerScope(group.provider))}
          />
        )
      })}
    </nav>
  )
}
