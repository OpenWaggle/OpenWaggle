import { AlertCircle, Check, ChevronRight, Clock, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/shared/Badge'
import { DiffView } from '@/components/thread/DiffView'
import { cn } from '@/lib/cn'
import { computeDiff } from '@/lib/diff'
import { formatDuration } from '@/lib/format'
import { getToolConfig, getToolSummary } from '@/lib/tool-display'

interface ToolCallBlockProps {
  name: string
  args: string
  state: string
  result?: { content: unknown; state: string; error?: string }
}

function tryParseDiffResult(
  content: unknown,
  name: string,
  args: Record<string, unknown>,
): { beforeContent: string; afterContent: string; filePath: string } | null {
  if (name !== 'editFile' && name !== 'writeFile') return null
  const parsed = parseResultPayload(content)
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { beforeContent?: unknown }).beforeContent === 'string' &&
    typeof (parsed as { afterContent?: unknown }).afterContent === 'string'
  ) {
    const diffContent = parsed as { beforeContent: string; afterContent: string }
    const filePath = typeof args.path === 'string' ? args.path : 'file'
    return {
      beforeContent: diffContent.beforeContent,
      afterContent: diffContent.afterContent,
      filePath,
    }
  }
  return null
}

function parseResultPayload(content: unknown): unknown {
  const parsed = parseUnknownJson(content)
  if (typeof parsed === 'object' && parsed !== null) {
    const maybeNormalized = parsed as { kind?: unknown; data?: unknown; text?: unknown }
    if (maybeNormalized.kind === 'json') {
      return maybeNormalized.data
    }
    if (maybeNormalized.kind === 'text') {
      return typeof maybeNormalized.text === 'string' ? maybeNormalized.text : ''
    }
  }
  return parsed
}

function parseUnknownJson(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content) as unknown
  } catch {
    return content
  }
}

function getResultError(result: ToolCallBlockProps['result']): string | null {
  if (!result) return null
  if (result.error) return result.error
  if (result.state === 'error') return 'Tool execution failed.'

  const parsed = parseResultPayload(result.content)
  if (typeof parsed === 'object' && parsed !== null) {
    const maybeError = parsed as { error?: unknown }
    if (typeof maybeError.error === 'string') {
      return maybeError.error
    }
  }
  return null
}

export function ToolCallBlock({
  name,
  args,
  state,
  result,
}: ToolCallBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const awaitingApproval = state === 'approval-requested'
  const isRunning = !awaitingApproval && (state !== 'input-complete' || !result)
  const resultError = getResultError(result)
  const isError = resultError !== null

  const config = getToolConfig(name)
  const Icon = config.icon

  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = JSON.parse(args)
  } catch {
    // keep empty
  }

  const summary = getToolSummary(name, parsedArgs)

  // Check if result has diff data
  const diffData = result && !isError ? tryParseDiffResult(result.content, name, parsedArgs) : null
  const diff =
    diffData && diffData.beforeContent !== diffData.afterContent
      ? computeDiff(diffData.beforeContent, diffData.afterContent, diffData.filePath)
      : null

  const startTime = useRef<number | null>(null)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (isRunning && !startTime.current) {
      startTime.current = Date.now()
    }
    if (!isRunning && startTime.current) {
      setDuration(Date.now() - startTime.current)
      startTime.current = null
    }
  }, [isRunning])

  return (
    <div className="rounded-lg border border-diff-card-border bg-diff-card-bg overflow-hidden">
      {/* Header row — h36, padding [0,14] */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 h-9 px-3.5 text-[14px] hover:bg-bg-hover transition-colors"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-text-muted transition-transform shrink-0',
            expanded && 'rotate-90',
          )}
        />
        <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" />
        <span className="font-medium text-text-secondary text-[13px]">{config.displayName}</span>

        {summary && (
          <span className="truncate text-text-tertiary font-mono text-[13px]">{summary}</span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Diff stats inline */}
          {diff && (
            <span className="flex items-center gap-1.5 text-[13px]">
              <span className="text-success">+{diff.additions}</span>
              <span className="text-error">-{diff.deletions}</span>
            </span>
          )}
          {duration > 0 && (
            <span className="flex items-center gap-1 text-[13px] text-text-tertiary">
              <Clock className="h-3 w-3" />
              {formatDuration(duration)}
            </span>
          )}
          {isRunning && !result && <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />}
          {awaitingApproval && (
            <Badge variant="warning">
              <Clock className="h-3 w-3 mr-0.5" />
              Awaiting approval
            </Badge>
          )}
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

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Inline diff for file tools */}
          {diff && diffData && (
            <div className="px-3 py-2">
              <DiffView diff={diff} filePath={diffData.filePath} />
            </div>
          )}

          {/* Arguments */}
          <div className="px-3 py-2">
            <div className="text-[13px] text-text-tertiary mb-1">Arguments</div>
            <ToolArgs name={name} args={parsedArgs} rawArgs={args} />
          </div>

          {/* Result */}
          {result && !diff && !isError && (
            <div className="border-t border-border px-3 py-2">
              <div className="text-[13px] text-text-tertiary mb-1">Result</div>
              <ToolResult content={result.content} isError={isError} />
            </div>
          )}

          {/* Error from diff tool */}
          {result && isError && (
            <div className="border-t border-border px-3 py-2">
              <div className="text-[13px] text-text-tertiary mb-1">Error</div>
              <ToolResult content={resultError ?? result.content} isError />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Args display ────────────────────────────────────────────

function ToolArgs({
  name,
  args,
  rawArgs,
}: {
  name: string
  args: Record<string, unknown>
  rawArgs: string
}): React.JSX.Element {
  if (name === 'runCommand' && typeof args.command === 'string') {
    return (
      <div className="rounded-md bg-bg px-3 py-2 font-mono text-[13px] text-text-secondary">
        <span className="text-text-muted select-none">$ </span>
        {args.command}
      </div>
    )
  }

  const entries = Object.entries(args)
  if (entries.length === 0) {
    return (
      <pre className="text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto">
        {rawArgs || '{}'}
      </pre>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => {
        const display = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        const isLong = typeof display === 'string' && display.length > 120
        return (
          <div key={key}>
            <span className="text-[13px] text-text-tertiary">{key}: </span>
            {isLong ? (
              <pre className="mt-0.5 text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto max-h-[200px] overflow-y-auto">
                {display}
              </pre>
            ) : (
              <span className="text-[13px] font-mono text-text-secondary">{display}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Result display ──────────────────────────────────────────

function ToolResult({
  content,
  isError,
}: {
  content: unknown
  isError: boolean
}): React.JSX.Element {
  if (isError) {
    const parsed = parseResultPayload(content)
    let errorMessage = formatUnknownContent(parsed)
    if (typeof parsed === 'object' && parsed !== null) {
      const asObject = parsed as { error?: unknown; message?: unknown }
      if (typeof asObject.error === 'string') {
        errorMessage = asObject.error
      } else if (typeof asObject.message === 'string') {
        errorMessage = asObject.message
      }
    }

    return (
      <div className="rounded-md border border-error/20 bg-error/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-error shrink-0 mt-0.5" />
          <pre className="text-[13px] font-mono text-error whitespace-pre-wrap break-words flex-1">
            {errorMessage}
          </pre>
        </div>
      </div>
    )
  }

  const parsed = parseResultPayload(content)
  let displayContent = formatUnknownContent(parsed)

  if (typeof parsed === 'object' && parsed !== null) {
    const asObject = parsed as { message?: unknown; content?: unknown }
    if (typeof asObject.message === 'string') {
      displayContent = asObject.message
    } else if (typeof asObject.content === 'string') {
      displayContent = asObject.content
    }
  }

  return (
    <pre className="text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words">
      {displayContent}
    </pre>
  )
}

function formatUnknownContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (content === null || content === undefined) return ''
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}
