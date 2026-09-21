import { X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
export function ActionEditorHeading(props: {
  readonly id: string
  readonly choosing: boolean
  readonly editing: boolean
  readonly busy: boolean
  readonly onClose: () => void
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <p className="mb-1 text-xs text-text-tertiary">
          {props.choosing ? '1 of 2 · Choose a task' : '2 of 2 · Make it yours'}
        </p>
        <h2 id={props.id} className="text-base font-semibold">
          {props.editing ? 'Edit action' : 'Add project action'}
        </h2>
        <p className="mt-1 text-xs text-text-tertiary">
          {props.choosing
            ? 'Start with a task your project already defines.'
            : 'Run it from any session in this project.'}
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
