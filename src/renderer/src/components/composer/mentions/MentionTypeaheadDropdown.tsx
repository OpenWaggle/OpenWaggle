import type { FileSuggestion } from '@shared/types/composer'
import { FileText, Folder } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

const ICON_SIZE = 14
const MAX_VISIBLE_ITEMS = 8
const ITEM_HEIGHT_PX = 32

interface MentionTypeaheadDropdownProps {
  items: FileSuggestion[]
  highlightIndex: number
  position: { top: number; left: number }
  onSelect: (item: FileSuggestion) => void
  onClose: () => void
}

export function MentionTypeaheadDropdown({
  items,
  highlightIndex,
  position,
  onSelect,
  onClose,
}: MentionTypeaheadDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const highlighted = containerRef.current?.children[highlightIndex]
    if (highlighted instanceof HTMLElement) {
      highlighted.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  if (items.length === 0) return null

  const maxHeight = MAX_VISIBLE_ITEMS * ITEM_HEIGHT_PX

  return createPortal(
    <div
      ref={containerRef}
      className={cn(
        'fixed z-50 min-w-[280px] max-w-[400px] rounded-lg border border-border-light bg-bg-secondary',
        'shadow-lg overflow-y-auto py-1',
      )}
      style={{
        bottom: window.innerHeight - position.top,
        left: position.left,
        maxHeight,
      }}
    >
      {items.map((item, index) => {
        const dirPart = item.path.includes('/')
          ? item.path.slice(0, item.path.lastIndexOf('/') + 1)
          : ''
        return (
          <button
            key={item.path}
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-left',
              index === highlightIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover',
            )}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(item)
            }}
          >
            {item.isDirectory ? (
              <Folder size={ICON_SIZE} className="shrink-0 text-text-tertiary" />
            ) : (
              <FileText size={ICON_SIZE} className="shrink-0 text-text-tertiary" />
            )}
            <span className="truncate">
              {dirPart && <span className="text-text-muted">{dirPart}</span>}
              <span className="text-text-primary font-medium">{item.basename}</span>
            </span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
