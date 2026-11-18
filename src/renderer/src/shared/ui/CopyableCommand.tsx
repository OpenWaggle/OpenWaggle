import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from './Button'

const COPY_FEEDBACK_MS = 2_000

type CopyState = 'idle' | 'copied' | 'failed'

const COPY_FEEDBACK: Readonly<Record<CopyState, string>> = {
  idle: '',
  copied: 'Copied',
  failed: 'Copy failed',
}

/** One shell command the user runs themselves, with a copy button that confirms the copy. */
export function CopyableCommand({ command }: { readonly command: string }) {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [state])

  const copy = () => {
    try {
      api.copyToClipboard(command)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
      <code
        className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
        title={command}
      >
        {command}
      </code>
      <output
        aria-live="polite"
        className={
          state === 'failed' ? 'shrink-0 text-xs text-error-text' : 'shrink-0 text-xs text-success'
        }
      >
        {COPY_FEEDBACK[state]}
      </output>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy command"
        title="Copy command"
        onClick={copy}
      >
        {state === 'copied' ? (
          <Check className="size-3" aria-hidden="true" />
        ) : (
          <Copy className="size-3" aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
