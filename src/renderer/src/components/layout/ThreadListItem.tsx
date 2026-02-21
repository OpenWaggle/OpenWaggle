import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelativeTime, truncate } from '@/lib/format'
import { api } from '@/lib/ipc'

interface ThreadListItemProps {
  readonly conversation: ConversationSummary
  readonly isActive: boolean
  readonly onSelect: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
}

export function ThreadListItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: ThreadListItemProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center h-[34px] w-full',
        isActive
          ? 'bg-bg-active border-l-2 border-accent pr-3 pl-12'
          : 'pl-11 pr-3 hover:bg-bg-hover',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className="min-w-0 flex-1 truncate text-left"
      >
        <span
          className={cn(
            'truncate text-[12px]',
            isActive ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
        >
          {truncate(conversation.title, 29)}
        </span>
      </button>
      <span className="ml-auto shrink-0 text-[11px] text-text-tertiary group-hover:hidden">
        {formatRelativeTime(conversation.updatedAt)}
      </span>
      {!isActive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void api
              .showConfirm('Delete this thread?', 'This cannot be undone.')
              .then((confirmed) => {
                if (confirmed) onDelete(conversation.id)
              })
          }}
          className="ml-auto hidden shrink-0 rounded-md p-0.5 text-text-muted transition-colors group-hover:block hover:text-error"
          title="Delete thread"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
