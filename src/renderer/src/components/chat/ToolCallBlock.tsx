import { AlertCircle, Check, ChevronRight, Clock, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { DiffView } from '@/components/thread/DiffView'
import { cn } from '@/lib/cn'
import { computeDiff } from '@/lib/diff'
import { formatDuration } from '@/lib/format'
import { parseToolArgs } from '@/lib/tool-args'
import { getToolActionText } from '@/lib/tool-display'

interface ToolCallBlockProps {
  name: string
  args: string
  state: string
  result?: { content: unknown; state: string; error?: string }
}

const screenshotResultSchema = z.object({
  base64Image: z.string(),
  pageTitle: z.string(),
  url: z.string(),
})

function tryParseScreenshotResult(
  content: unknown,
  name: string,
): z.infer<typeof screenshotResultSchema> | null {
  if (name !== 'browserScreenshot') return null
  const payload = parseResultPayload(content)
  const parsed = screenshotResultSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
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
    'beforeContent' in parsed &&
    typeof parsed.beforeContent === 'string' &&
    'afterContent' in parsed &&
    typeof parsed.afterContent === 'string'
  ) {
    const filePath = typeof args.path === 'string' ? args.path : 'file'
    return {
      beforeContent: parsed.beforeContent,
      afterContent: parsed.afterContent,
      filePath,
    }
  }
  return null
}

function parseResultPayload(content: unknown): unknown {
  const parsed = parseUnknownJson(content)
  if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed) {
    if (parsed.kind === 'json' && 'data' in parsed) {
      return parsed.data
    }
    if (parsed.kind === 'text' && 'text' in parsed) {
      return typeof parsed.text === 'string' ? parsed.text : ''
    }
  }
  return parsed
}

function parseUnknownJson(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    const data: unknown = JSON.parse(content)
    return data
  } catch {
    return content
  }
}

function getResultError(result: ToolCallBlockProps['result']): string | null {
  if (!result) return null
  if (result.error) return result.error
  if (result.state === 'error') return 'Tool execution failed.'

  const parsed = parseResultPayload(result.content)
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'error' in parsed &&
    typeof parsed.error === 'string'
  ) {
    return parsed.error
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

  const parsedArgs = parseToolArgs(args)

  // Check if result has screenshot data
  const screenshotData = result && !isError ? tryParseScreenshotResult(result.content, name) : null

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

  const actionText = getToolActionText(name, parsedArgs, isRunning)

  return (
    <div className="group/tool">
      {/* Compact activity line */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-0.5 text-[13px] transition-colors"
      >
        {/* Status icon */}
        {isRunning && !awaitingApproval && (
          <Loader2 className="h-3.5 w-3.5 text-text-tertiary animate-spin shrink-0" />
        )}
        {awaitingApproval && <Clock className="h-3.5 w-3.5 text-warning shrink-0" />}
        {result && !isError && !isRunning && (
          <Check className="h-3.5 w-3.5 text-text-muted shrink-0" />
        )}
        {result && isError && <X className="h-3.5 w-3.5 text-error/80 shrink-0" />}

        {/* Action text */}
        <span
          className={cn(
            'truncate',
            isRunning && !awaitingApproval && 'text-text-tertiary',
            awaitingApproval && 'text-warning',
            result && !isError && !isRunning && 'text-text-muted',
            result && isError && 'text-error/80',
          )}
        >
          {actionText}
        </span>

        {awaitingApproval && (
          <span className="text-warning/70 text-[12px] shrink-0">(approval needed)</span>
        )}

        {/* Diff stats */}
        {diff && (
          <span className="flex items-center gap-1 text-[12px] shrink-0">
            <span className="text-success">+{diff.additions}</span>
            <span className="text-error">-{diff.deletions}</span>
          </span>
        )}

        {/* Duration */}
        {duration > 0 && !isRunning && (
          <span className="text-[12px] text-text-muted shrink-0">{formatDuration(duration)}</span>
        )}

        {/* Chevron — visible on hover */}
        <ChevronRight
          className={cn(
            'ml-auto h-3 w-3 text-text-muted shrink-0 transition-transform',
            'invisible group-hover/tool:visible',
            expanded && 'visible rotate-90',
          )}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="ml-5 mt-1 rounded-md border border-border bg-bg-secondary/50 overflow-hidden">
          {/* Screenshot preview */}
          {screenshotData && (
            <div className="px-3 py-2">
              <div className="text-[13px] text-text-tertiary mb-1">
                {screenshotData.pageTitle} — {screenshotData.url}
              </div>
              <img
                src={`data:image/png;base64,${screenshotData.base64Image}`}
                alt={`Screenshot of ${screenshotData.pageTitle}`}
                className="max-w-full rounded-md"
              />
            </div>
          )}

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
          {result && !diff && !screenshotData && !isError && (
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
      if ('error' in parsed && typeof parsed.error === 'string') {
        errorMessage = parsed.error
      } else if ('message' in parsed && typeof parsed.message === 'string') {
        errorMessage = parsed.message
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
    if ('message' in parsed && typeof parsed.message === 'string') {
      displayContent = parsed.message
    } else if ('content' in parsed && typeof parsed.content === 'string') {
      displayContent = parsed.content
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
