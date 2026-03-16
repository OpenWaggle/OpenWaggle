import { Plus } from 'lucide-react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'

interface ComposerAttachButtonProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function ComposerAttachButton({ fileInputRef }: ComposerAttachButtonProps) {
  const { projectPath } = useProject()

  return (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={!projectPath}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-button-border text-text-tertiary transition-colors',
        projectPath
          ? 'hover:bg-bg-hover hover:text-text-secondary'
          : 'cursor-not-allowed opacity-60',
      )}
      title={projectPath ? 'Attach files' : 'Select a project first'}
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  )
}
