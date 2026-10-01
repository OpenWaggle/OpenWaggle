import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import { cn } from '@/shared/lib/cn'
import { TextInput } from '@/shared/ui/TextInput'
import type { SessionTitleRenameController } from '../hooks/useSessionTitleRename'

/** The inline field that replaces a Session title while it is being renamed. */
export function SessionTitleInput({
  rename,
  className,
}: {
  readonly rename: SessionTitleRenameController
  readonly className?: string
}) {
  return (
    <TextInput
      ref={rename.inputRef}
      aria-label="Session title"
      value={rename.draft}
      maxLength={SESSION_TITLE_MAX_LENGTH}
      onChange={(event) => rename.setDraft(event.target.value)}
      onBlur={rename.blur}
      onKeyDown={(event) => {
        // Enter and Escape confirm or cancel an IME composition, not the rename.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          rename.submit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          rename.cancel()
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      variant="transparent"
      inputSize="sm"
      className={cn('h-auto min-w-0 flex-1 px-0', className)}
    />
  )
}
