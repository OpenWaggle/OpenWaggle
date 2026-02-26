import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { isProvider } from '@shared/types/settings'
import { Check, Search, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  AnthropicIcon,
  GeminiIcon,
  GrokIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/components/icons/provider-icons'
import { useClickOutside } from '@/hooks/useClickOutside'
import { cn } from '@/lib/cn'
import { useSettingsStore } from '@/stores/settings-store'

type RailTab = 'favorites' | Provider

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId) => void
  settings: Settings
  providerModels: ProviderInfo[]
  className?: string
}

interface IndexedModel {
  readonly key: string
  readonly id: string
  readonly name: string
  readonly provider: Provider
  readonly providerDisplayName: string
  readonly providerInfo: ProviderInfo
}

interface ModelAvailability {
  readonly selectable: boolean
  readonly reason?: string
}

type ProviderIcon = (props: { className?: string }) => React.JSX.Element

const PROVIDER_ICON_BY_ID = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  gemini: GeminiIcon,
  grok: GrokIcon,
  openrouter: OpenRouterIcon,
  ollama: OllamaIcon,
} as const satisfies Record<Provider, ProviderIcon>

function normalizeSearchToken(value: string): string {
  return value.trim().toLowerCase()
}

function modelOptionId(model: IndexedModel): string {
  return `model-option-${model.key.replaceAll(':', '-').replaceAll('/', '-')}`
}

export function ModelSelector({
  value,
  onChange,
  settings,
  providerModels,
  className,
}: ModelSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<RailTab>('favorites')
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const toggleFavoriteModel = useSettingsStore((s) => s.toggleFavoriteModel)
  const toggleProvider = useSettingsStore((s) => s.toggleProvider)

  const indexedModels: IndexedModel[] = []
  const seenModelKeys = new Set<string>()
  const modelById = new Map<string, IndexedModel>()
  const providerGroups = new Map<Provider, ProviderInfo>()

  for (const group of providerModels) {
    if (!isProvider(group.provider)) continue
    if (!providerGroups.has(group.provider)) {
      providerGroups.set(group.provider, group)
    }

    for (const model of group.models) {
      const modelId = model.id.trim()
      if (!modelId) continue

      const key = `${group.provider}:${modelId}`
      if (seenModelKeys.has(key)) continue
      seenModelKeys.add(key)

      const indexed: IndexedModel = {
        key,
        id: modelId,
        name: model.name.trim() || modelId,
        provider: group.provider,
        providerDisplayName: group.displayName,
        providerInfo: group,
      }
      indexedModels.push(indexed)
      if (!modelById.has(indexed.id)) {
        modelById.set(indexed.id, indexed)
      }
    }
  }
  const railProviders = Array.from(providerGroups.values())

  const favoriteSet = new Set(settings.favoriteModels)

  const favoriteModels: IndexedModel[] = []
  for (const favoriteModel of settings.favoriteModels) {
    const entry = modelById.get(favoriteModel)
    if (entry) {
      favoriteModels.push(entry)
    }
  }

  const tabModels =
    activeTab === 'favorites'
      ? favoriteModels
      : indexedModels.filter((model) => model.provider === activeTab)

  const query = normalizeSearchToken(searchQuery)
  const visibleModels =
    query.length === 0
      ? tabModels
      : tabModels.filter((model) => {
          const haystack = `${model.name} ${model.id} ${model.providerDisplayName} ${model.provider}`
          return normalizeSearchToken(haystack).includes(query)
        })

  const selectedModel = modelById.get(value)
  const activeDescendantModel = focusedIndex >= 0 ? visibleModels[focusedIndex] : undefined

  useClickOutside(ref, () => setIsOpen(false))

  useEffect(() => {
    if (!isOpen) return

    const timeoutId = window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const selectedIndex = visibleModels.findIndex((model) => model.id === value)
    if (selectedIndex >= 0) {
      setFocusedIndex(selectedIndex)
      return
    }

    if (visibleModels.length > 0) {
      setFocusedIndex(0)
      return
    }

    setFocusedIndex(-1)
  }, [isOpen, value, visibleModels])

  function openDropdown(): void {
    const selected = modelById.get(value)
    const nextTab: RailTab = favoriteSet.has(value)
      ? 'favorites'
      : selected
        ? selected.provider
        : (railProviders[0]?.provider ?? 'favorites')

    setSearchQuery('')
    setActiveTab(nextTab)
    setIsOpen(true)
  }

  function getModelAvailability(model: IndexedModel): ModelAvailability {
    if (!model.providerInfo.requiresApiKey) {
      return { selectable: true }
    }

    const config = settings.providers[model.provider]
    const hasApiKey = (config?.apiKey?.trim().length ?? 0) > 0
    if (!hasApiKey) {
      return { selectable: false, reason: 'Set API key in Connections' }
    }

    return { selectable: true }
  }

  async function selectModel(model: IndexedModel): Promise<void> {
    const availability = getModelAvailability(model)
    if (!availability.selectable) return

    const config = settings.providers[model.provider]
    if (!(config?.enabled ?? false)) {
      await toggleProvider(model.provider, true)
    }

    onChange(model.id)
    setIsOpen(false)
  }

  function moveFocus(step: 1 | -1): void {
    if (visibleModels.length === 0) return

    setFocusedIndex((prev) => {
      if (prev < 0) {
        return step > 0 ? 0 : visibleModels.length - 1
      }

      return (prev + step + visibleModels.length) % visibleModels.length
    })
  }

  function triggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault()
      openDropdown()
    }
  }

  function listboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const focusedModel = focusedIndex >= 0 ? visibleModels[focusedIndex] : undefined
      if (focusedModel) {
        void selectModel(focusedModel)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  function searchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation()

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
      return
    }

    if (event.key === 'Enter') {
      const focusedModel = focusedIndex >= 0 ? visibleModels[focusedIndex] : undefined
      if (focusedModel) {
        event.preventDefault()
        void selectModel(focusedModel)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        onKeyDown={triggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="no-drag flex items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <span className="truncate max-w-[180px] text-[12px]">{selectedModel?.name ?? value}</span>
        <span className="text-[9px] text-text-tertiary">&#x2228;</span>
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-activedescendant={
            activeDescendantModel ? modelOptionId(activeDescendantModel) : undefined
          }
          tabIndex={0}
          onKeyDown={listboxKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1 h-[620px] w-[480px] overflow-hidden rounded-2xl border border-border-light bg-bg-secondary p-3 shadow-2xl"
        >
          <div className="mb-2.5 flex h-[44px] items-center gap-2 rounded-xl border border-border bg-bg px-3">
            <Search className="h-4 w-4 text-text-tertiary" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={searchKeyDown}
              placeholder="Search models..."
              className="h-full flex-1 bg-transparent text-[14px] text-text-secondary placeholder:text-text-tertiary focus:outline-none focus-visible:shadow-none"
              aria-label="Search models"
            />
          </div>

          <div className="flex h-[558px] gap-2.5">
            <div className="flex h-full w-[52px] flex-col items-center gap-4 overflow-hidden rounded-2xl border border-border bg-bg px-0 py-3">
              <button
                type="button"
                title="Favorite models"
                onClick={() => setActiveTab('favorites')}
                className={cn(
                  'flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition-colors',
                  activeTab === 'favorites'
                    ? 'border-border-light bg-bg-hover text-accent'
                    : 'border-transparent text-text-tertiary hover:border-border hover:bg-bg-hover',
                )}
                aria-label="Show favorite models"
              >
                <Star
                  className="h-4 w-4"
                  fill={activeTab === 'favorites' ? 'currentColor' : 'none'}
                />
              </button>

              {railProviders.map((group) => {
                const provider = group.provider
                const Icon = PROVIDER_ICON_BY_ID[provider]
                const isActive = activeTab === provider

                return (
                  <button
                    key={provider}
                    type="button"
                    title={group.displayName}
                    onClick={() => setActiveTab(provider)}
                    className={cn(
                      'flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border transition-colors',
                      isActive
                        ? 'border-border-light bg-bg-hover text-text-primary'
                        : 'border-transparent text-text-tertiary hover:border-border hover:bg-bg-hover',
                    )}
                    aria-label={`Show ${group.displayName} models`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                )
              })}
            </div>

            <div className="flex h-full flex-1 flex-col overflow-hidden rounded-xl bg-bg p-0.5">
              <div className="h-full overflow-y-auto">
                {railProviders.length === 0 && (
                  <div className="px-4 py-6 text-[13px] text-text-tertiary">
                    No providers available.
                  </div>
                )}

                {railProviders.length > 0 &&
                  activeTab === 'favorites' &&
                  favoriteModels.length === 0 && (
                    <div className="px-4 py-6 text-[13px] text-text-tertiary">
                      No favorites yet. Click the star on any model to save it.
                    </div>
                  )}

                {railProviders.length > 0 &&
                  visibleModels.length === 0 &&
                  !(activeTab === 'favorites' && favoriteModels.length === 0) && (
                    <div className="px-4 py-6 text-[13px] text-text-tertiary">
                      No models match your search.
                    </div>
                  )}

                {visibleModels.map((model, index) => {
                  const availability = getModelAvailability(model)
                  const isSelected = model.id === value
                  const isFocused = index === focusedIndex
                  const isFavorite = favoriteSet.has(model.id)

                  return (
                    <div
                      id={modelOptionId(model)}
                      key={model.key}
                      role="option"
                      tabIndex={-1}
                      aria-selected={isSelected}
                      aria-disabled={!availability.selectable}
                      onClick={() => {
                        if (!availability.selectable) return
                        void selectModel(model)
                      }}
                      onKeyDown={(event) => {
                        if (!availability.selectable) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void selectModel(model)
                        }
                      }}
                      onMouseEnter={() => setFocusedIndex(index)}
                      className={cn(
                        'group flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors',
                        availability.selectable
                          ? 'cursor-pointer text-text-primary hover:bg-bg-hover'
                          : 'cursor-not-allowed text-text-muted',
                        isSelected && 'bg-bg-hover',
                        isFocused && 'ring-1 ring-inset ring-border-light',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[17px] font-semibold text-text-primary">
                          {model.name}
                        </div>
                        {availability.reason && (
                          <div className="truncate text-[13px] text-text-tertiary">
                            {availability.reason}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {isSelected && <Check className="h-4 w-4 text-accent" />}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void toggleFavoriteModel(model.id)
                          }}
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
                            isFavorite
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border-light bg-bg-secondary text-text-secondary hover:text-accent',
                          )}
                          aria-label={
                            isFavorite
                              ? `Remove ${model.name} from favorites`
                              : `Add ${model.name} to favorites`
                          }
                          aria-pressed={isFavorite}
                        >
                          <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
