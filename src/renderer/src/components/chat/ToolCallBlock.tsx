import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/shared/Badge'
import { cn } from '@/lib/cn'

interface ToolCallBlockProps {
  name: string
  args: string
  state: string
  result?: { content: string; state: string; error?: string }
}

export function ToolCallBlock({
  name,
  args,
  state,
  result,
}: ToolCallBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isRunning = state !== 'input-complete' || !result
  const isError = result?.state === 'error'

  let parsedArgs: string
  try {
    parsedArgs = JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    parsedArgs = args
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-bg-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-text-muted transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <Wrench className="h-3.5 w-3.5 text-text-muted" />
        <span className="font-mono text-text-secondary">{name}</span>

        <div className="ml-auto flex items-center gap-2">
          {isRunning && !result && <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />}
          {result && !isError && (
            <Badge variant="success">
              <Check className="h-3 w-3 mr-0.5" />
              Done
            </Badge>
          )}
          {result && isError && (
            <Badge variant="error">
              <X className="h-3 w-3 mr-0.5" />
              Error
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="px-3 py-2">
            <div className="text-xs text-text-muted mb-1">Arguments</div>
            <pre className="text-xs font-mono text-text-secondary bg-bg rounded p-2 overflow-x-auto">
              {parsedArgs}
            </pre>
          </div>

          {result && (
            <div className="border-t border-border px-3 py-2">
              <div className="text-xs text-text-muted mb-1">Result</div>
              <pre
                className={cn(
                  'text-xs font-mono bg-bg rounded p-2 overflow-x-auto max-h-[300px] overflow-y-auto',
                  isError ? 'text-error' : 'text-text-secondary',
                )}
              >
                {result.error ?? result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
