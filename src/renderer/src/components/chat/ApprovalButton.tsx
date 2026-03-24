import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

type ApprovalButtonVariant = 'deny' | 'approve' | 'approve-outline'

interface ApprovalButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly variant: ApprovalButtonVariant
  readonly disabled: boolean
  readonly onClick: () => void
}

const VARIANT_CLASSES: Record<ApprovalButtonVariant, string> = {
  deny: 'bg-error/15 text-error hover:bg-error/25',
  approve: 'bg-success/15 text-success hover:bg-success/25',
  'approve-outline': 'border border-success/30 text-success hover:bg-success/10',
}

export function ApprovalButton({
  icon: Icon,
  label,
  variant,
  disabled,
  onClick,
}: ApprovalButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors disabled:opacity-50',
        VARIANT_CLASSES[variant],
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}
