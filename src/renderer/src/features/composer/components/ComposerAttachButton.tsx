import { Plus } from 'lucide-react'
import { useProject } from '@/features/sessions/hooks'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface ComposerAttachButtonProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function ComposerAttachButton({ fileInputRef }: ComposerAttachButtonProps) {
  const { projectPath } = useProject()

  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={!projectPath}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border border-button-border text-text-tertiary transition-colors',
        projectPath
          ? 'hover:bg-bg-hover hover:text-text-secondary'
          : 'cursor-not-allowed opacity-60',
      )}
      title={projectPath ? 'Attach files' : 'Select a project first'}
    >
      <Plus className="size-3.5" />
    </Button>
  )
}
