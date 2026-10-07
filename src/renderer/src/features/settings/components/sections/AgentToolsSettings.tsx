import type { PiCacheWarmingMode } from '@shared/types/settings'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const logger = createRendererLogger('settings/agent-tools')

const CODEMODE_LABEL = 'Codemode'
const CACHE_WARMING_LABEL = 'Keep prompt caches warm'

/**
 * Pi keeps a cache warm between Runs only while its session stays open. OpenWaggle opens a Pi
 * session for each Run, so "between runs" (`idle`) is not offered: it would warm nothing more.
 */
const CACHE_WARMING_CHOICES = [
  ['off', 'Off'],
  ['streaming', 'While working'],
] as const satisfies ReadonlyArray<readonly [PiCacheWarmingMode, string]>

function useSavingAction<T>(action: (value: T) => Promise<void>, failure: string) {
  const [saving, setSaving] = useState(false)
  const run = (value: T) => {
    if (saving) return
    setSaving(true)
    void action(value)
      .catch((error: unknown) => {
        logger.warn(failure, { error: String(error) })
      })
      .finally(() => setSaving(false))
  }
  return { saving, run }
}

function CodemodeSetting() {
  const enabled = usePreferencesStore((state) => state.settings.codemodeEnabled)
  const setCodemodeEnabled = usePreferencesStore((state) => state.setCodemodeEnabled)
  const { saving, run } = useSavingAction(setCodemodeEnabled, 'Failed to update codemode')

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">{CODEMODE_LABEL}</span>
        <span className="text-xs text-text-tertiary">
          Let the agent write a short script that calls several tools in one step. Each tool the
          script calls still asks for approval when it normally would. MCP servers set to use
          codemode keep it on.
        </span>
      </div>
      <ToggleSwitch
        checked={enabled}
        onCheckedChange={run}
        label={CODEMODE_LABEL}
        disabled={saving}
      />
    </div>
  )
}

function CacheWarmingSetting() {
  const mode = usePreferencesStore((state) => state.settings.cacheWarming)
  const setCacheWarming = usePreferencesStore((state) => state.setCacheWarming)
  const { saving, run } = useSavingAction(setCacheWarming, 'Failed to update cache warming')
  const selected = mode === 'off' ? 'off' : 'streaming'

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">{CACHE_WARMING_LABEL}</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          During long tool calls, resend the conversation so the provider keeps it cached, when that
          saves more than it costs. Refreshes count toward the Session's usage.
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={CACHE_WARMING_LABEL}
        className="flex shrink-0 rounded-md border border-border bg-bg-secondary p-0.5"
      >
        {CACHE_WARMING_CHOICES.map(([value, label]) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected === value}
            size="xs"
            variant="ghost"
            disabled={saving}
            className={cn(
              'h-7 px-2.5 text-xs',
              selected === value && 'bg-bg-hover text-text-primary shadow-sm',
            )}
            onClick={() => {
              if (value !== selected) run(value)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function AgentToolsSettings() {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Agent tools</h3>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <CodemodeSetting />
        <CacheWarmingSetting />
      </div>
    </div>
  )
}
