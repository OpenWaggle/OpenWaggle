import { X } from 'lucide-react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
export function ActionEditorHeading(props: {
  readonly id: string
  readonly projectPath: string
  readonly editing: boolean
  readonly busy: boolean
  readonly onClose: () => void
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 id={props.id} className="text-base font-semibold">
          {props.editing ? 'Edit action' : 'Add action'}
        </h2>
        <p className="mt-1 truncate text-xs text-text-tertiary" title={props.projectPath}>
          {projectName(props.projectPath)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label="Close action editor"
        onClick={props.onClose}
        disabled={props.busy}
      >
        <X className="size-4" />
      </Button>
    </header>
  )
}
