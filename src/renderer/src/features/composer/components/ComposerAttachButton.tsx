import { FileCode2, Paperclip, Plus, Radio, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { insertComposerInvocation } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useProject } from '@/features/sessions/hooks'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'

interface ComposerAttachButtonProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

function AddMenuItem({
  description,
  icon,
  label,
  onSelect,
}: {
  readonly description: string
  readonly icon: React.ReactNode
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      className={DENSE_MENU_ITEM_CLASS}
      fullWidth
      leftIcon={<span className="text-text-tertiary">{icon}</span>}
      onClick={onSelect}
      role="menuitem"
      variant="row"
    >
      <span className="flex min-w-0 flex-col items-start">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-xs font-normal text-text-tertiary">{description}</span>
      </span>
    </Button>
  )
}

/** The composer + menu, routing every entry through the existing native draft flow. */
export function ComposerAttachButton({ fileInputRef }: ComposerAttachButtonProps) {
  const [open, setOpen] = useState(false)
  const { projectPath } = useProject()
  const setSlashMenuFilter = useComposerStore((state) => state.setSlashMenuFilter)
  const disabled = !projectPath

  function invoke(invocation: '@' | '/', filter: 'all' | 'skills' | 'waggle' = 'all') {
    setOpen(false)
    setSlashMenuFilter(filter)
    insertComposerInvocation(invocation)
  }

  return (
    <Popover
      className="w-72 p-1"
      onOpenChange={setOpen}
      open={open}
      placement="top-start"
      role="menu"
      trigger={({ toggle }) => (
        <Button
          aria-label="Add to message"
          className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          disabled={disabled}
          onClick={toggle}
          title={projectPath ? 'Add to message' : 'Select a project first'}
          variant="unstyled"
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      )}
    >
      <div className={MENU_SECTION_LABEL_CLASS}>Add to message</div>
      <AddMenuItem
        description="Choose files from your computer"
        icon={<Paperclip aria-hidden="true" className="size-4" />}
        label="Attach files"
        onSelect={() => {
          setOpen(false)
          fileInputRef.current?.click()
        }}
      />
      <AddMenuItem
        description="Insert an @ reference to a project file"
        icon={<FileCode2 aria-hidden="true" className="size-4" />}
        label="Reference project file"
        onSelect={() => invoke('@')}
      />
      <div className="my-1 border-t border-border-light" />
      <div className={MENU_SECTION_LABEL_CLASS}>OpenWaggle</div>
      <AddMenuItem
        description="Apply an enabled project skill"
        icon={<Sparkles aria-hidden="true" className="size-4" />}
        label="Use a skill"
        onSelect={() => invoke('/', 'skills')}
      />
      <AddMenuItem
        description="Run with a multi-agent collaboration preset"
        icon={<Radio aria-hidden="true" className="size-4" />}
        label="Start Waggle"
        onSelect={() => invoke('/', 'waggle')}
      />
      <p className="mx-1 mt-1 border-t border-border-light px-2 pb-1 pt-2 text-xs text-text-muted">
        Drop files here, or type @ for files and / for skills or Waggle.
      </p>
    </Popover>
  )
}
