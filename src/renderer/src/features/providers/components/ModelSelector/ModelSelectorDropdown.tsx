import type { RefObject } from 'react'
import { useProviderStore } from '../../state/provider-store'
import { ModelSelectorList } from './ModelSelectorList'
import type { FlatModel } from './types'

const DROPDOWN_WIDTH = 220
const DROPDOWN_MAX_HEIGHT = 320
const VERTICAL_GAP = 4

interface ModelSelectorDropdownProps {
  readonly dropdownRef: RefObject<HTMLDivElement | null>
  readonly models: readonly FlatModel[]
  readonly selectedModel: FlatModel | undefined
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  readonly onSelectModel: (model: FlatModel) => void
}

const DROPDOWN_CLASS =
  'absolute z-[9999] flex flex-col overflow-hidden rounded-xl border border-border bg-bg p-1.5 shadow-2xl'
const DROPDOWN_STYLE = {
  bottom: `calc(100% + ${VERTICAL_GAP}px)`,
  left: 0,
  width: DROPDOWN_WIDTH,
  maxHeight: DROPDOWN_MAX_HEIGHT,
}

/** Why the picker has no models: the provider catalog failed to load, or none is enabled. */
function ModelSelectorEmptyState() {
  const catalogLoadError = useProviderStore((s) => s.loadError)
  if (catalogLoadError !== null) {
    return (
      <div className="px-3 py-4 text-center">
        <p className="text-xs text-error-text">Couldn't load providers.</p>
        <p className="mt-1 text-xs text-text-muted">Retry in Settings → Connections.</p>
      </div>
    )
  }
  return (
    <div className="px-3 py-4 text-center">
      <p className="text-xs text-text-tertiary">No models configured.</p>
      <p className="mt-1 text-xs text-text-muted">Go to Settings → Connections to enable models.</p>
    </div>
  )
}

export function ModelSelectorDropdown({
  dropdownRef,
  models,
  selectedModel,
  onKeyDown,
  onSelectModel,
}: ModelSelectorDropdownProps) {
  // A listbox may only own options, so with none the popup is a dialog holding the notice.
  if (models.length === 0) {
    return (
      <div
        ref={dropdownRef}
        role="dialog"
        aria-label="Models"
        data-model-picker-open
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={DROPDOWN_CLASS}
        style={DROPDOWN_STYLE}
      >
        <ModelSelectorEmptyState />
      </div>
    )
  }

  return (
    <div
      ref={dropdownRef}
      role="listbox"
      data-model-picker-open
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={DROPDOWN_CLASS}
      style={DROPDOWN_STYLE}
    >
      <div className="overflow-y-auto">
        <ModelSelectorList
          models={models}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
        />
      </div>
    </div>
  )
}
