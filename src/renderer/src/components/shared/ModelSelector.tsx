import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { isProvider } from '@shared/types/settings'
import { Search, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AnthropicIcon,
  GeminiIcon,
  GrokIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/components/icons/provider-icons'
import { cn } from '@/lib/cn'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'

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
  readonly id: SupportedModelId
  readonly name: string
  readonly provider: Provider
  readonly providerDisplayName: string
  readonly providerInfo: ProviderInfo
}

interface ModelAvailability {
  readonly selectable: boolean
  readonly reason?: string
}

interface OverlayPosition {
  readonly top: number
  readonly left: number
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

function getModelSubtitle(model: IndexedModel, availability: ModelAvailability): string | null {
  if (availability.reason) return availability.reason
  if (model.provider === 'ollama') return 'Runs locally with your Ollama setup'
  if (model.id !== model.name) return model.id
  return null
}

interface ModelSelectorDropdownRefs {
  readonly dropdownRef: React.RefObject<HTMLDivElement | null>
  readonly searchRef: React.RefObject<HTMLInputElement | null>
}

interface ModelSelectorDropdownState {
  readonly overlayPosition: OverlayPosition
  readonly searchQuery: string
  readonly railProviders: ProviderInfo[]
  readonly activeTab: RailTab
  readonly favoriteModels: IndexedModel[]
  readonly visibleModels: IndexedModel[]
  readonly selectedModelId: SupportedModelId
  readonly favoriteSet: Set<SupportedModelId>
}

interface ModelSelectorDropdownActions {
  readonly onListboxKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  readonly onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  readonly onSearchQueryChange: (query: string) => void
  readonly onSelectTab: (tab: RailTab) => void
  readonly getModelAvailability: (model: IndexedModel) => ModelAvailability
  readonly onSelectModel: (model: IndexedModel) => Promise<void>
  readonly onToggleFavoriteModel: (model: SupportedModelId) => Promise<void>
}

interface ModelSelectorDropdownOptions {
  readonly refs: ModelSelectorDropdownRefs
  readonly state: ModelSelectorDropdownState
  readonly actions: ModelSelectorDropdownActions
}

function renderModelSelectorDropdown(options: ModelSelectorDropdownOptions): React.JSX.Element {
  const { refs, state, actions } = options
  const {
    overlayPosition,
    searchQuery,
    railProviders,
    activeTab,
    favoriteModels,
    visibleModels,
    selectedModelId,
    favoriteSet,
  } = state
  const {
    onListboxKeyDown,
    onSearchKeyDown,
    onSearchQueryChange,
    onSelectTab,
    getModelAvailability,
    onSelectModel,
    onToggleFavoriteModel,
  } = actions

  return (
    <div
      ref={refs.dropdownRef}
      role="listbox"
      tabIndex={0}
      onKeyDown={onListboxKeyDown}
      className="fixed z-[9999] flex h-[620px] w-[480px] flex-col gap-[10px] overflow-hidden rounded-2xl border border-[#1e2229] bg-[#0d0f12] p-3 shadow-2xl"
      style={{ top: overlayPosition.top, left: overlayPosition.left }}
    >
      <div className="flex h-[44px] shrink-0 items-center gap-2 rounded-xl border border-[#1e2229] bg-[#111418] px-3">
        <Search className="h-4 w-4 text-[#7A708D]" />
        <input
          ref={refs.searchRef}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search models..."
          className="model-selector-search-input h-full flex-1 bg-transparent text-[14px] text-[#e7e9ee] placeholder:text-[#9098a8] outline-none focus:outline-none focus-visible:outline-none"
          aria-label="Search models"
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-[10px]">
        <div className="flex h-full w-[52px] shrink-0 flex-col items-center gap-6 overflow-hidden rounded-[12px] border border-[#1e2229] bg-[#111418] px-0 py-[14px]">
          <button
            type="button"
            title="Favorite models"
            onClick={() => onSelectTab('favorites')}
            className={cn(
              'flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition-colors',
              activeTab === 'favorites'
                ? 'border-[#2a2f3a] bg-[#1a1f28] text-[#F3C969]'
                : 'border-transparent bg-transparent text-[#9098a8] hover:text-[#b7bfce]',
            )}
            aria-label="Show favorite models"
          >
            <Star className="h-4 w-4" fill={activeTab === 'favorites' ? 'currentColor' : 'none'} />
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
                onClick={() => onSelectTab(provider)}
                className={cn(
                  'flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition-colors',
                  isActive
                    ? 'border-[#2a2f3a] bg-[#1a1f28] text-[#e7e9ee]'
                    : 'border-transparent bg-transparent text-[#9098a8] hover:text-[#b7bfce]',
                )}
                aria-label={`Show ${group.displayName} models`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}

          <div aria-hidden className="min-h-0 flex-1" />
        </div>

        <div className="flex min-h-0 h-full flex-1 flex-col overflow-hidden rounded-xl p-0.5">
          <div className="h-full overflow-y-auto">
            {railProviders.length === 0 && (
              <div className="px-4 py-6 text-[13px] text-[#9098a8]">No providers available.</div>
            )}

            {railProviders.length > 0 &&
              activeTab === 'favorites' &&
              favoriteModels.length === 0 && (
                <div className="px-4 py-6 text-[13px] text-[#9098a8]">
                  No favorites yet. Click the star on any model to save it.
                </div>
              )}

            {railProviders.length > 0 &&
              visibleModels.length === 0 &&
              !(activeTab === 'favorites' && favoriteModels.length === 0) && (
                <div className="px-4 py-6 text-[13px] text-[#9098a8]">
                  No models match your search.
                </div>
              )}

            <div className="space-y-[2px]">
              {visibleModels.map((model) => {
                const availability = getModelAvailability(model)
                const isSelected = model.id === selectedModelId
                const isFavorite = favoriteSet.has(model.id)
                const subtitle = getModelSubtitle(model, availability)

                return (
                  <div
                    id={modelOptionId(model)}
                    key={model.key}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    aria-disabled={!availability.selectable}
                    aria-label={model.name}
                    onClick={() => {
                      if (!availability.selectable) return
                      void onSelectModel(model)
                    }}
                    onKeyDown={(event) => {
                      if (!availability.selectable) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void onSelectModel(model)
                      }
                    }}
                    className={cn(
                      'group flex h-[78px] w-full items-center gap-2 rounded-[10px] px-[10px] py-[10px] text-left transition-colors',
                      availability.selectable
                        ? 'cursor-pointer text-[#e7e9ee] hover:bg-[#171b21]'
                        : 'cursor-not-allowed text-[#6f7786]',
                      isSelected && 'bg-[#1a1f28]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-semibold text-[#e7e9ee]">
                        {model.name}
                      </div>
                      <div className="mt-1 truncate text-[12px] text-[#9098a8]">
                        {subtitle ?? '\u00A0'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void onToggleFavoriteModel(model.id)
                      }}
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#2a2f3a] bg-[#1a1f28] text-[#F3C969] transition-colors hover:brightness-110"
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
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
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
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>({ top: 0, left: 0 })

  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const toggleFavoriteModel = usePreferencesStore((s) => s.toggleFavoriteModel)
  const toggleProvider = useProviderStore((s) => s.toggleProvider)

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
      const trimmedId = model.id.trim()
      if (!trimmedId) continue
      const modelId = SupportedModelId(trimmedId)

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
  useEffect(() => {
    if (!isOpen) return

    const timeoutId = window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const DROPDOWN_WIDTH = 480
    const DROPDOWN_HEIGHT = 620
    const VIEWPORT_PADDING = 8
    const VERTICAL_GAP = 4

    function updateOverlayPosition(): void {
      const anchor = ref.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()

      const left = Math.min(
        Math.max(VIEWPORT_PADDING, rect.left),
        window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PADDING,
      )
      const preferredTop = rect.top - DROPDOWN_HEIGHT - VERTICAL_GAP
      const top = Math.max(VIEWPORT_PADDING, preferredTop)

      setOverlayPosition({ top, left })
    }

    function onMouseDown(event: MouseEvent): void {
      if (!(event.target instanceof Node)) return
      if (ref.current?.contains(event.target)) return
      if (dropdownRef.current?.contains(event.target)) return
      setIsOpen(false)
    }

    updateOverlayPosition()
    window.addEventListener('resize', updateOverlayPosition)
    window.addEventListener('scroll', updateOverlayPosition, true)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('resize', updateOverlayPosition)
      window.removeEventListener('scroll', updateOverlayPosition, true)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [isOpen])

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
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  function searchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation()

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
        className="no-drag flex h-[26px] items-center gap-[5px] rounded-md border border-button-border px-2.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <span className="max-w-[180px] truncate text-[12px]">{selectedModel?.name ?? value}</span>
        <span className="text-[9px] text-text-tertiary">&#x2228;</span>
      </button>

      {isOpen &&
        createPortal(
          renderModelSelectorDropdown({
            refs: {
              dropdownRef,
              searchRef,
            },
            state: {
              overlayPosition,
              searchQuery,
              railProviders,
              activeTab,
              favoriteModels,
              visibleModels,
              selectedModelId: value,
              favoriteSet,
            },
            actions: {
              onListboxKeyDown: listboxKeyDown,
              onSearchKeyDown: searchKeyDown,
              onSearchQueryChange: setSearchQuery,
              onSelectTab: setActiveTab,
              getModelAvailability,
              onSelectModel: selectModel,
              onToggleFavoriteModel: toggleFavoriteModel,
            },
          }),
          document.body,
        )}
    </div>
  )
}
