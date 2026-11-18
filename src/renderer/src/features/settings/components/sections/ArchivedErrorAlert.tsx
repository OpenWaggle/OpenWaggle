import { cn } from '@/shared/lib/cn'

interface ArchivedErrorAlertProps {
  readonly message: string
  readonly subtle?: boolean
}

export function ArchivedErrorAlert({ message, subtle = false }: ArchivedErrorAlertProps) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md px-3 py-2 text-xs text-error-text',
        subtle ? 'border border-error/20 bg-error/5' : 'border border-error/30 bg-error/10',
      )}
    >
      {message}
    </p>
  )
}
