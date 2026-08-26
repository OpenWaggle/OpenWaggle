import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'

/**
 * The request's own words, in the durable row.
 *
 * A consent body is built as several lines and often carries a JSON payload, so rendering it as one
 * paragraph collapsed it into an unreadable run-on and put protocol detail into what should be a
 * human sentence. Multi-line bodies go behind a disclosure, pre-wrapped and height capped, exactly
 * as the live ribbon does; a single-line message needs none of that and stays inline.
 */
export function InteractionMessage({ message }: { readonly message: string }) {
  const [open, setOpen] = useState(false)
  const firstLine = message.split('\n', 1)[0] ?? message
  const isMultiLine = message.trimEnd().includes('\n')

  if (!isMultiLine) {
    return <p className="mt-2 text-xs leading-5 text-text-secondary">{message}</p>
  }

  return (
    <div className="mt-2">
      <p className="truncate text-xs leading-5 text-text-secondary">{firstLine}</p>
      <Button
        aria-expanded={open}
        className="mt-1 gap-1 text-xs text-text-muted"
        onClick={() => setOpen((current) => !current)}
        size="xs"
        variant="ghost"
      >
        <ChevronDown className={`size-3 ${open ? '' : '-rotate-90'}`} />
        Details
      </Button>
      {open ? (
        <pre className="mt-1 max-h-40 max-w-full min-w-0 overflow-auto rounded-lg border border-border/65 bg-bg/70 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-text-secondary [overflow-wrap:anywhere]">
          {message}
        </pre>
      ) : null}
    </div>
  )
}
