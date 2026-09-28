import { cn } from '@/shared/lib/cn'
import type { ShortcutBrowserSource } from '../../lib/shortcut-browser-model'

export function ShortcutSourceBadge({ source }: { readonly source: ShortcutBrowserSource }) {
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide',
        source === 'Project'
          ? 'border-accent/25 bg-accent/8 text-accent'
          : 'border-border bg-bg text-text-muted',
      )}
    >
      {source}
    </span>
  )
}
