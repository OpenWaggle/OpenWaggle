import type { SessionId } from '@shared/types/brand'
import { SessionTitleInput, useSessionTitleRename } from '@/features/session-title'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const HEADER_TITLE_CLASS = 'no-drag min-w-0 truncate text-sm font-medium text-text-primary'

/** The Session identity header's title; a double-click renames the selected Session in place. */
export function HeaderSessionTitle({
  sessionId,
  title,
}: {
  readonly sessionId: SessionId | null
  readonly title: string
}) {
  const rename = useSessionTitleRename(sessionId, title)

  if (rename.isEditing) {
    return (
      <SessionTitleInput
        rename={rename}
        className="no-drag font-medium text-sm text-text-primary"
      />
    )
  }

  if (sessionId === null) {
    return (
      <span data-qa="header-session-title" className={HEADER_TITLE_CLASS} title={title}>
        {title}
      </span>
    )
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      data-qa="header-session-title"
      className={cn(HEADER_TITLE_CLASS, 'cursor-default text-left')}
      title={title}
      onDoubleClick={rename.start}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'F2') return
        event.preventDefault()
        rename.start()
      }}
    >
      {title}
    </Button>
  )
}
