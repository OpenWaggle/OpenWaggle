import type { RefObject } from 'react'
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

export function ModelSelectorDropdown({
  dropdownRef,
  models,
  selectedModel,
  onKeyDown,
  onSelectModel,
}: ModelSelectorDropdownProps) {
  return (
    <div
      ref={dropdownRef}
      role="listbox"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="absolute z-[9999] flex flex-col overflow-hidden rounded-xl border border-[#1e2229] bg-[#0d0f12] p-1.5 shadow-2xl"
      style={{
        bottom: `calc(100% + ${VERTICAL_GAP}px)`,
        left: 0,
        width: DROPDOWN_WIDTH,
        maxHeight: DROPDOWN_MAX_HEIGHT,
      }}
    >
      {models.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <p className="text-[12px] text-text-tertiary">No models configured.</p>
          <p className="mt-1 text-[11px] text-text-muted">
            Go to Settings → Connections to enable models.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto">
          <ModelSelectorList
            models={models}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
          />
        </div>
      )}
    </div>
  )
}
