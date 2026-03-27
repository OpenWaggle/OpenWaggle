import { Link } from 'lucide-react'
import { cn } from '@/lib/cn'

const ICON_SIZE = 12

interface URLMentionChipProps {
  url: string
}

export function URLMentionChip({ url }: URLMentionChipProps) {
  // Show hostname for display, full URL on hover
  let displayText = url
  try {
    const parsed = new URL(url)
    displayText = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
  } catch {
    // Keep full URL if parsing fails
  }

  return (
    <span
      className={cn(
        'bg-info/10 text-info rounded px-1.5 py-0.5 text-[13px]',
        'inline-flex items-center gap-1',
        'select-none cursor-default',
      )}
      title={url}
    >
      <Link size={ICON_SIZE} className="shrink-0" />
      <span className="truncate max-w-[200px]">{displayText}</span>
    </span>
  )
}
