import { FileCode2, Paperclip, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'

interface SessionSourceAddMenuProps {
  readonly onAttachFiles: () => void
  readonly onReferenceProjectFile: () => void
}

function SourceMenuItem({
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

export function SessionSourceAddMenu({
  onAttachFiles,
  onReferenceProjectFile,
}: SessionSourceAddMenuProps) {
  const [open, setOpen] = useState(false)
  const select = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <Popover
      className="w-72 p-1"
      onOpenChange={setOpen}
      open={open}
      placement="top-end"
      role="menu"
      trigger={({ toggle }) => (
        <Button
          aria-label="Add a source"
          className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          onClick={toggle}
          title="Add a source"
          type="button"
          variant="unstyled"
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      )}
    >
      <div className={MENU_SECTION_LABEL_CLASS}>Add a source</div>
      <SourceMenuItem
        description="Choose files from your computer"
        icon={<Paperclip aria-hidden="true" className="size-4" />}
        label="Attach files"
        onSelect={() => select(onAttachFiles)}
      />
      <SourceMenuItem
        description="Insert an @ reference to a project file"
        icon={<FileCode2 aria-hidden="true" className="size-4" />}
        label="Reference project file"
        onSelect={() => select(onReferenceProjectFile)}
      />
    </Popover>
  )
}
