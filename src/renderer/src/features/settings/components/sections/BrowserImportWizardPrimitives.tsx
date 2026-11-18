import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

export function WizardDialogHeader({
  headingId,
  title,
  description,
}: {
  readonly headingId: string
  readonly title: string
  readonly description: string
}) {
  return (
    <header className="space-y-1">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {title}
      </h2>
      <p className="text-sm leading-5 text-text-tertiary">{description}</p>
    </header>
  )
}

export function WizardDialogFooter({ children }: { readonly children: React.ReactNode }) {
  return <footer className="flex flex-wrap items-center justify-end gap-2">{children}</footer>
}

export function WizardSelectableTile({
  selected,
  title,
  subtitle,
  onSelect,
}: {
  readonly selected: boolean
  readonly title: string
  readonly subtitle?: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="unstyled"
      aria-label={subtitle ? `${title}, ${subtitle}` : title}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-accent/55 bg-accent/8'
          : 'border-border bg-bg-secondary hover:border-border-light hover:bg-bg-hover',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text-primary">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs tabular-nums text-text-tertiary">{subtitle}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          selected ? 'border-accent bg-accent text-bg' : 'border-border-light',
        )}
      >
        {selected ? <Check className="size-2.5" /> : null}
      </span>
    </Button>
  )
}

export function cookieCountLabel(count: number | undefined) {
  if (count === undefined) return undefined
  if (count === 0) return 'No cookies'
  return `${count.toLocaleString()} ${count === 1 ? 'cookie' : 'cookies'}`
}

export function cookieResultLabel(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? 'cookie' : 'cookies'}`
}
