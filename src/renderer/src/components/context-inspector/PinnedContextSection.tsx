import type { ConversationId } from '@shared/types/brand'
import type { PinnedItem } from '@shared/types/context'
import { ChevronRight, Pin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { estimateTokens, formatTokens } from '@/lib/format-tokens'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useContextStore } from '@/stores/context-store'

const logger = createRendererLogger('pinned-context')
const INSTRUCTION_TEXTAREA_ROWS = 3

interface PinnedContextSectionProps {
  readonly conversationId: ConversationId
}

export function PinnedContextSection({ conversationId }: PinnedContextSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<PinnedItem[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newInstruction, setNewInstruction] = useState('')

  // Re-fetch pins when the snapshot's pin count changes (e.g., pinned from chat bubble)
  const pinnedItemCount = useContextStore((s) => s.snapshot?.pinnedItemCount ?? 0)

  // Re-fetch pins when conversation changes or pin count changes externally.
  useEffect(() => {
    // pinnedItemCount is read to trigger re-fetch when pins change via chat bubble
    if (pinnedItemCount >= 0) {
      void api
        .listPins(conversationId)
        .then(setItems)
        .catch((err) => logger.warn('Failed to load pins', { error: err }))
    }
  }, [conversationId, pinnedItemCount])

  async function handleAddInstruction() {
    const text = newInstruction.trim()
    if (!text) return
    try {
      await api.addPin(conversationId, { type: 'instruction', content: text })
      setNewInstruction('')
      setIsAdding(false)
      // No explicit refresh needed — snapshot push updates pinnedItemCount → triggers useEffect
    } catch (err) {
      logger.warn('Failed to add pin', { error: err })
    }
  }

  async function handleRemove(pinId: string) {
    try {
      await api.removePin(conversationId, pinId)
      // No explicit refresh needed — snapshot push updates pinnedItemCount → triggers useEffect
    } catch (err) {
      logger.warn('Failed to remove pin', { error: err })
    }
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
        <Pin className="h-3 w-3" />
        <span className="font-medium">Pinned Context</span>
        {items.length > 0 && (
          <span className="ml-auto rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] text-text-muted tabular-nums">
            {items.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {items.length === 0 && !isAdding && (
            <p className="py-1 text-[11px] text-text-muted leading-relaxed">
              Pin messages or add instructions to preserve them during compaction.
            </p>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className="group/pin flex items-start gap-2 rounded-lg bg-bg-tertiary/50 border border-border/50 p-2.5"
            >
              <Pin className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    {item.type}
                  </span>
                  <span className="text-[10px] text-text-muted font-mono tabular-nums">
                    {formatTokens(estimateTokens(item.content))}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-text-secondary leading-relaxed line-clamp-3">
                  {item.content}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(item.id)}
                className="shrink-0 rounded p-1 text-text-muted opacity-0 group-hover/pin:opacity-100 hover:text-error hover:bg-error/10 transition-all"
                title="Remove pin"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {isAdding ? (
            <div className="space-y-2">
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="Enter instruction to preserve during compaction..."
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent/40 focus:outline-none resize-none leading-relaxed"
                rows={INSTRUCTION_TEXTAREA_ROWS}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAddInstruction()}
                  disabled={!newInstruction.trim()}
                  className="h-[26px] px-3 rounded-md bg-accent/10 text-[12px] font-medium text-accent border border-accent/20 hover:bg-accent/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Pin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(false)
                    setNewInstruction('')
                  }}
                  className="h-[26px] px-3 rounded-md text-[12px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-dashed border-border text-[11px] text-text-muted hover:text-text-secondary hover:border-border-light transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add instruction
            </button>
          )}
        </div>
      )}
    </div>
  )
}
