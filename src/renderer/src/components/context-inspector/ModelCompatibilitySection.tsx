import type { ConversationId } from '@shared/types/brand'
import type { ModelCompatibilityInfo } from '@shared/types/context'
import { ChevronRight, Loader2, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/cn'
import { formatContextWindow } from '@/lib/format-tokens'
import { api } from '@/lib/ipc'
import { usePreferencesStore } from '@/stores/preferences-store'

interface ModelCompatibilitySectionProps {
  readonly conversationId: ConversationId
}

const STATUS_LABEL: Record<string, string> = {
  comfortable: 'Comfortable',
  'tight-fit': 'Tight fit',
  'would-compact': 'Would compact',
  blocked: 'Blocked',
}

const STATUS_DOT: Record<string, string> = {
  comfortable: 'bg-success',
  'tight-fit': 'bg-warning',
  'would-compact': 'bg-warning',
  blocked: 'bg-error',
}

export function ModelCompatibilitySection({ conversationId }: ModelCompatibilitySectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [models, setModels] = useState<ModelCompatibilityInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [confirmModel, setConfirmModel] = useState<ModelCompatibilityInfo | null>(null)

  const currentModel = usePreferencesStore((s) => s.settings.selectedModel)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)

  useEffect(() => {
    if (expanded) {
      setIsLoading(true)
      void api
        .getModelCompatibility(conversationId)
        .then(setModels)
        .catch(() => setModels([]))
        .finally(() => setIsLoading(false))
    }
  }, [conversationId, expanded])

  function handleModelClick(model: ModelCompatibilityInfo) {
    if (model.compatibility === 'blocked') return
    if (model.modelId === currentModel) return
    if (model.compatibility === 'would-compact') {
      setConfirmModel(model)
      return
    }
    void setSelectedModel(model.modelId)
  }

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover/50 transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-90')}
        />
        <Monitor className="h-3 w-3" />
        <span className="font-medium">Model Compatibility</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-0.5">
          {isLoading ? (
            <div className="flex items-center gap-1.5 py-3 text-[11px] text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          ) : models.length === 0 ? (
            <p className="py-1 text-[11px] text-text-muted">No models available.</p>
          ) : (
            models.map((model) => {
              const isBlocked = model.compatibility === 'blocked'
              const isCurrent = model.modelId === currentModel
              const isClickable = !isBlocked && !isCurrent

              return (
                <button
                  key={String(model.modelId)}
                  type="button"
                  disabled={isBlocked}
                  onClick={() => handleModelClick(model)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[12px] text-left transition-colors',
                    isClickable && 'hover:bg-bg-hover cursor-pointer',
                    isBlocked && 'opacity-40 cursor-not-allowed',
                    isCurrent && 'bg-bg-hover/70',
                  )}
                  title={
                    isBlocked
                      ? "Context exceeds this model's window. Compact first."
                      : isCurrent
                        ? 'Currently selected'
                        : `Switch to ${model.displayName}`
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        STATUS_DOT[model.compatibility] ?? 'bg-text-muted',
                      )}
                    />
                    <span
                      className={cn(
                        'text-text-secondary',
                        isCurrent && 'font-medium text-text-primary',
                      )}
                    >
                      {model.displayName}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono tabular-nums">
                      {formatContextWindow(model.contextWindow)}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {isCurrent
                      ? 'Current'
                      : (STATUS_LABEL[model.compatibility] ?? model.compatibility)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}

      {confirmModel && (
        <ConfirmDialog
          title="Switch model?"
          message={`Switching to ${confirmModel.displayName} (${formatContextWindow(confirmModel.contextWindow)}) may require compaction. The current conversation could exceed this model's comfortable range.`}
          confirmLabel="Switch anyway"
          variant="warning"
          onConfirm={() => {
            void setSelectedModel(confirmModel.modelId)
            setConfirmModel(null)
          }}
          onCancel={() => setConfirmModel(null)}
        />
      )}
    </div>
  )
}
