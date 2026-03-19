import { ModelSelectorRow } from './ModelSelectorRow'
import type { FlatModel } from './types'

interface ModelSelectorListProps {
  readonly models: readonly FlatModel[]
  readonly selectedModel: FlatModel | undefined
  readonly onSelectModel: (model: FlatModel) => void
}

export function ModelSelectorList({
  models,
  selectedModel,
  onSelectModel,
}: ModelSelectorListProps) {
  if (models.length === 0) {
    return (
      <div className="px-4 py-6 text-[13px] text-[#9098a8]">
        No models available. Configure providers in Connections.
      </div>
    )
  }

  return (
    <div className="space-y-px">
      {models.map((model) => {
        const compositeKey = model.authMethod
          ? `${model.provider}:${model.authMethod}:${model.id}`
          : `${model.provider}:${model.id}`
        // Match by id + provider + authMethod so duplicate model IDs show the correct checkmark
        const isSelected =
          selectedModel !== undefined &&
          model.id === selectedModel.id &&
          model.provider === selectedModel.provider &&
          model.authMethod === selectedModel.authMethod
        return (
          <ModelSelectorRow
            key={compositeKey}
            model={model}
            isSelected={isSelected}
            onSelect={onSelectModel}
          />
        )
      })}
    </div>
  )
}
