import type { ModelDisplayInfo } from '@shared/types/llm'
import { Brain } from 'lucide-react'
import {
  highlightSegments,
  isReasoningModel,
} from '@/features/settings/lib/available-models-filter'
import { formatContextWindow } from '@/shared/lib/format-tokens'
import { Checkbox } from '@/shared/ui/Checkbox'

interface ModelCheckboxRowProps {
  readonly model: ModelDisplayInfo
  readonly checked: boolean
  readonly search: string
  /** Shown before the model name when the list mixes providers. */
  readonly providerLabel?: string | undefined
  readonly onToggle: (modelRef: string, enabled: boolean) => void
}

function Highlighted({ text, search }: { readonly text: string; readonly search: string }) {
  return highlightSegments(text, search).map((segment) =>
    segment.match ? (
      <mark key={segment.start} className="rounded-sm bg-accent/15 px-px text-accent">
        {segment.text}
      </mark>
    ) : (
      <span key={segment.start}>{segment.text}</span>
    ),
  )
}

export function ModelCheckboxRow({
  model,
  checked,
  search,
  providerLabel,
  onToggle,
}: ModelCheckboxRowProps) {
  return (
    <Checkbox
      checked={checked}
      onChange={() => onToggle(model.id, !checked)}
      className="accent-accent"
      label={
        <>
          {providerLabel !== undefined && (
            <span className="w-28 shrink-0 truncate text-xs text-text-tertiary">
              <Highlighted text={providerLabel} search={search} />
            </span>
          )}
          <span className="shrink-0 truncate text-xs text-text-primary">
            <Highlighted text={model.name} search={search} />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
            <Highlighted text={model.modelId} search={search} />
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted tabular-nums">
            {isReasoningModel(model) && (
              <Brain className="size-3.5" aria-label="Reasoning" role="img" />
            )}
            {model.contextWindow !== undefined && (
              <span>{formatContextWindow(model.contextWindow)}</span>
            )}
            {!model.available && <span className="text-accent-dim">Auth required</span>}
          </span>
        </>
      }
      labelClassName="h-8 gap-2.5 rounded-lg px-2 hover:bg-bg-hover"
    />
  )
}
