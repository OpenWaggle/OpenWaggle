import type { McpServerSummary } from '@shared/types/mcp'
import { cn } from '@/shared/lib/cn'

export function formatServerDetail(server: McpServerSummary) {
  if (server.url) return server.url
  if (server.command) return server.command
  return 'No valid transport configured'
}

export function titleCase(value: string) {
  return value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'success' | 'warning' | 'error' | 'accent'
  readonly children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-bg-tertiary text-text-muted',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'error' && 'bg-error/10 text-error-text',
        tone === 'accent' && 'bg-accent/10 text-accent',
      )}
    >
      {children}
    </span>
  )
}
