import type { JsonObject } from '@shared/types/json'
import { hasConcreteToolOutput, normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'
import { AlertCircle, Check, ChevronRight, Clipboard, GitBranch, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { resolveLanguage } from '@/lib/shiki/highlighter'
import { parseToolArgs } from '@/lib/tool-args'
import { resolveActionText } from '@/lib/tool-display'
import { StreamingText } from './StreamingText'

const JSON_STRINGIFY_SPACES = 2
const LONG_ARGUMENT_PREVIEW_CHARS = 120
const LONG_ARGUMENT_MAX_HEIGHT_PX = 200
const RESULT_MAX_HEIGHT_PX = 300
const INLINE_DIFF_LINE_LIMIT = 32
const OUTPUT_PREVIEW_LINES = 6
const LINE_SPLIT_SEPARATOR = '\n'
const HIGHLIGHT_MAX_CHARS = 80_000
const HIGHLIGHT_MAX_LINES = 1_200
const MIN_MARKDOWN_FENCE_LENGTH = 3
const FILE_CONTENT_ARG_KEYS = new Set(['content', 'oldString', 'newString'])

interface ToolCallBlockProps {
  name: string
  args: string
  state: string
  result?: { content: unknown; state: string; sourceMessageId?: string; error?: string }
  isStreaming?: boolean
  onBranchFromMessage?: (messageId: string) => void
}

interface UnifiedDiffLine {
  readonly type: 'add' | 'remove' | 'context' | 'meta'
  readonly content: string
}

interface UnifiedDiffData {
  readonly text: string
  readonly lines: readonly UnifiedDiffLine[]
  readonly additions: number
  readonly deletions: number
}

function isTextContentBlock(
  value: unknown,
): value is { readonly type: 'text'; readonly text: string } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string'
}

function parseResultPayload(content: unknown): unknown {
  return normalizeToolResultPayload(content)
}

function formatUnknownContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (content === null || content === undefined) return ''
  try {
    return JSON.stringify(content, null, JSON_STRINGIFY_SPACES)
  } catch {
    return String(content)
  }
}

function getToolResultDetails(content: unknown): unknown {
  const parsed = parseResultPayload(content)
  if (!isRecord(parsed) || !('details' in parsed)) {
    return undefined
  }
  return parsed.details
}

function textFromContentBlocks(content: readonly unknown[]): string | null {
  const textBlocks: string[] = []
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textBlocks.push(block.text)
    }
  }
  return textBlocks.length > 0 ? textBlocks.join('\n') : null
}

function stringField(value: { readonly [key: string]: unknown }, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

function textFromResultRecord(parsed: { readonly [key: string]: unknown }): string | null {
  const content = parsed.content
  if (Array.isArray(content)) {
    const contentText = textFromContentBlocks(content)
    if (contentText) {
      return contentText
    }
  }

  return stringField(parsed, 'message') ?? stringField(parsed, 'error')
}

function getToolResultText(content: unknown): string {
  const parsed = parseResultPayload(content)
  if (typeof parsed === 'string') return parsed
  if (!isRecord(parsed)) return formatUnknownContent(parsed)
  return textFromResultRecord(parsed) ?? formatUnknownContent(parsed)
}

function getStringArg(args: JsonObject, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' ? value : null
}

function inferLanguageFromPath(path: string | null): string | undefined {
  if (!path) {
    return undefined
  }

  const extension = path.split('.').pop()
  if (!extension || extension === path) {
    return undefined
  }

  return resolveLanguage(extension.toLowerCase())
}

function exceedsLineLimit(text: string, maxLines: number): boolean {
  if (!text) return false

  let lineCount = 1
  for (const char of text) {
    if (char !== LINE_SPLIT_SEPARATOR) {
      continue
    }
    lineCount += 1
    if (lineCount > maxLines) {
      return true
    }
  }
  return false
}

function shouldHighlightCode(text: string): boolean {
  return text.length <= HIGHLIGHT_MAX_CHARS && !exceedsLineLimit(text, HIGHLIGHT_MAX_LINES)
}

function buildFencedCodeMarkdown(code: string, language: string | undefined): string {
  const fenceLength = Math.max(
    MIN_MARKDOWN_FENCE_LENGTH,
    ...Array.from(code.matchAll(/`+/g)).map((match) => match[0].length + 1),
  )
  const fence = '`'.repeat(fenceLength)
  return `${fence}${language ?? ''}\n${code}\n${fence}`
}

function getResultError(result: ToolCallBlockProps['result']): string | null {
  if (!result) return null
  if (result.error) return result.error
  if (result.state === 'error') {
    const text = getToolResultText(result.content).trim()
    return text || 'Tool execution failed.'
  }

  const parsed = parseResultPayload(result.content)
  if (isRecord(parsed) && typeof parsed.error === 'string') {
    return parsed.error
  }
  return null
}

function parseUnifiedDiff(diffText: string): UnifiedDiffData {
  let additions = 0
  let deletions = 0
  const lines = diffText.split(LINE_SPLIT_SEPARATOR).map((line): UnifiedDiffLine => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return { type: 'meta', content: line }
    }
    if (line.startsWith('+')) {
      additions += 1
      return { type: 'add', content: line }
    }
    if (line.startsWith('-')) {
      deletions += 1
      return { type: 'remove', content: line }
    }
    return { type: 'context', content: line }
  })

  return { text: diffText, lines, additions, deletions }
}

function getEditUnifiedDiff(content: unknown, name: string): UnifiedDiffData | null {
  if (name !== 'edit') {
    return null
  }

  const details = getToolResultDetails(content)
  if (isRecord(details) && typeof details.diff === 'string' && details.diff.trim()) {
    return parseUnifiedDiff(details.diff)
  }

  const parsed = parseResultPayload(content)
  if (
    isRecord(parsed) &&
    typeof parsed.beforeContent === 'string' &&
    typeof parsed.afterContent === 'string' &&
    parsed.beforeContent !== parsed.afterContent
  ) {
    return null
  }

  return null
}

function buildTailPreview(text: string): string {
  const lines = text.trim().split(LINE_SPLIT_SEPARATOR)
  return lines.slice(-OUTPUT_PREVIEW_LINES).join('\n')
}

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const { copied, copy } = useCopyToClipboard()
  if (!value) {
    return null
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      onClick={(event) => {
        event.stopPropagation()
        copy(value)
      }}
    >
      <Clipboard className="h-3 w-3" />
      {copied ? 'Copied' : label}
    </button>
  )
}

export function ToolCallBlock({
  name,
  args,
  state,
  result,
  isStreaming = false,
  onBranchFromMessage,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const hasConcreteResult = result ? hasConcreteToolOutput(result.content) : false
  const resultError = getResultError(result)
  const isError = resultError !== null
  const isRunning = isStreaming && (state === 'input-streaming' || state === 'executing' || !result)
  const awaitingResult = (!result || !hasConcreteResult) && !isRunning

  const parsedArgs = parseToolArgs(args)
  const diff = result && !isError ? getEditUnifiedDiff(result.content, name) : null
  const shouldReadResultText = result !== undefined && (expanded || isRunning || isError)
  const resultText = shouldReadResultText ? getToolResultText(result.content) : ''
  const command = getStringArg(parsedArgs, 'command')
  const path = getStringArg(parsedArgs, 'path')
  const inlineDiffVisible = diff !== null && diff.lines.length <= INLINE_DIFF_LINE_LIMIT
  const liveOutputPreview = isRunning && resultText.trim() ? buildTailPreview(resultText) : ''
  const failedOutputPreview =
    !expanded && isError && resultText.trim() ? buildTailPreview(resultText) : ''
  const branchSourceMessageId = result?.sourceMessageId

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

  const actionText = resolveActionText({
    name,
    args: parsedArgs,
    awaitingResult,
    isError,
    isRunning,
  })

  return (
    <div className="group/tool">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${actionText} — ${expanded ? 'collapse' : 'expand'} details`}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-[13px] transition-colors"
        >
          {isRunning && (
            <Loader2
              role="status"
              aria-label="Running"
              className="h-3.5 w-3.5 text-text-tertiary animate-spin shrink-0"
            />
          )}
          {hasConcreteResult && result && !isError && !isRunning && (
            <Check className="h-3.5 w-3.5 text-text-muted shrink-0" />
          )}
          {result && isError && <X className="h-3.5 w-3.5 text-error/80 shrink-0" />}

          <span
            className={cn(
              'truncate',
              isRunning && 'text-text-tertiary',
              hasConcreteResult && result && !isError && !isRunning && 'text-text-muted',
              result && isError && 'text-error/80',
            )}
          >
            {actionText}
          </span>

          {diff && (
            <span className="flex items-center gap-1 text-[12px] shrink-0">
              <span className="text-success">+{diff.additions}</span>
              <span className="text-error">-{diff.deletions}</span>
            </span>
          )}

          {duration > 0 && !isRunning && (
            <span className="text-[12px] text-text-muted shrink-0">{formatDuration(duration)}</span>
          )}

          <ChevronRight
            className={cn(
              'ml-auto h-3 w-3 text-text-muted shrink-0 transition-transform',
              'invisible group-hover/tool:visible',
              expanded && 'visible rotate-90',
            )}
          />
        </button>
        {branchSourceMessageId && onBranchFromMessage ? (
          <button
            type="button"
            title="Branch from tool result"
            onClick={() => onBranchFromMessage(branchSourceMessageId)}
            className="opacity-0 text-text-muted transition-opacity hover:text-text-secondary group-hover/tool:opacity-100 focus:opacity-100"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {!expanded && inlineDiffVisible && diff && (
        <div className="ml-5 mt-1">
          <UnifiedDiffView diff={diff} compact />
        </div>
      )}

      {!expanded && liveOutputPreview && (
        <pre className="ml-5 mt-1 max-h-[120px] overflow-hidden rounded-md bg-bg-secondary/60 px-3 py-2 text-[12px] font-mono text-text-tertiary whitespace-pre-wrap break-words">
          {liveOutputPreview}
        </pre>
      )}

      {!expanded && failedOutputPreview && (
        <pre className="ml-5 mt-1 max-h-[160px] overflow-hidden rounded-md border border-error/20 bg-error/5 px-3 py-2 text-[12px] font-mono text-error whitespace-pre-wrap break-words">
          {failedOutputPreview}
        </pre>
      )}

      {expanded && (
        <div className="ml-5 mt-1 rounded-md border border-border bg-bg-secondary/50 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <CopyButton label="Copy args" value={args} />
            {path && <CopyButton label="Copy path" value={path} />}
            {command && <CopyButton label="Copy command" value={command} />}
            {resultText && <CopyButton label="Copy output" value={resultText} />}
          </div>

          {diff && (
            <div className="px-3 py-2">
              <UnifiedDiffView diff={diff} />
            </div>
          )}

          <div className="px-3 py-2">
            <div className="text-[13px] text-text-tertiary mb-1">Arguments</div>
            <ToolArgs name={name} args={parsedArgs} rawArgs={args} path={path} />
          </div>

          {hasConcreteResult && result && !diff && !isError && (
            <div className="border-t border-border px-3 py-2">
              <div className="text-[13px] text-text-tertiary mb-1">Result</div>
              <ToolResult content={result.content} isError={isError} name={name} path={path} />
            </div>
          )}

          {result && isError && (
            <div role="alert" className="border-t border-border px-3 py-2">
              <div className="text-[13px] text-text-tertiary mb-1">Error</div>
              <ToolResult content={resultError ?? result.content} isError name={name} path={path} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolArgs({
  name,
  args,
  rawArgs,
  path,
}: {
  name: string
  args: JsonObject
  rawArgs: string
  path: string | null
}) {
  if (name === 'bash' && typeof args.command === 'string') {
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
        const display =
          typeof value === 'string' ? value : JSON.stringify(value, null, JSON_STRINGIFY_SPACES)
        const isLong = typeof display === 'string' && display.length > LONG_ARGUMENT_PREVIEW_CHARS
        return (
          <div key={key}>
            <span className="text-[13px] text-text-tertiary">{key}: </span>
            {isLong && typeof value === 'string' && FILE_CONTENT_ARG_KEYS.has(key) ? (
              <HighlightedFileContent
                content={value}
                language={inferLanguageFromPath(path)}
                maxHeight={LONG_ARGUMENT_MAX_HEIGHT_PX}
              />
            ) : isLong ? (
              <pre
                className="mt-0.5 text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto"
                style={{ maxHeight: LONG_ARGUMENT_MAX_HEIGHT_PX }}
              >
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

function HighlightedFileContent({
  content,
  language,
  maxHeight,
}: {
  content: string
  language: string | undefined
  maxHeight: number
}) {
  const canHighlight = shouldHighlightCode(content)

  if (!canHighlight) {
    return (
      <div>
        <div className="mb-1 text-[12px] text-text-muted">
          Large file preview shown without syntax highlighting to keep the UI responsive.
        </div>
        <pre
          className="text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words"
          style={{ maxHeight }}
        >
          {content}
        </pre>
      </div>
    )
  }

  return (
    <div className="tool-result-code overflow-y-auto" style={{ maxHeight }}>
      <StreamingText
        text={buildFencedCodeMarkdown(content, language)}
        className="[&_pre]:max-h-none [&_pre]:text-[13px] [&_pre]:leading-relaxed"
      />
    </div>
  )
}

function ToolResult({
  content,
  isError,
  name,
  path,
}: {
  content: unknown
  isError: boolean
  name: string
  path: string | null
}) {
  const displayContent = getToolResultText(content)

  if (isError) {
    return (
      <div className="rounded-md border border-error/20 bg-error/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-error shrink-0 mt-0.5" />
          <pre className="text-[13px] font-mono text-error whitespace-pre-wrap break-words flex-1">
            {displayContent}
          </pre>
        </div>
      </div>
    )
  }

  if (name === 'read' && displayContent) {
    return (
      <HighlightedFileContent
        content={displayContent}
        language={inferLanguageFromPath(path)}
        maxHeight={RESULT_MAX_HEIGHT_PX}
      />
    )
  }

  return (
    <pre
      className="text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words"
      style={{ maxHeight: RESULT_MAX_HEIGHT_PX }}
    >
      {displayContent}
    </pre>
  )
}

function UnifiedDiffView({
  diff,
  compact = false,
}: {
  readonly diff: UnifiedDiffData
  readonly compact?: boolean
}) {
  return (
    <div className="rounded-md border border-border overflow-hidden text-[12px] font-mono">
      <div className="flex items-center justify-between bg-bg-secondary px-3 py-1.5 border-b border-border">
        <span className="text-text-secondary">Diff</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {diff.additions > 0 && <span className="text-success">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="text-error">-{diff.deletions}</span>}
        </div>
      </div>
      <div className={cn('overflow-x-auto bg-bg', compact && 'max-h-[220px] overflow-y-hidden')}>
        {diff.lines.map((line, index) => (
          <div
            key={`${String(index)}-${line.type}`}
            className={cn(
              'flex whitespace-pre px-3',
              line.type === 'add' && 'bg-success/10 text-success',
              line.type === 'remove' && 'bg-error/10 text-error',
              line.type === 'meta' && 'text-text-muted',
              line.type === 'context' && 'text-text-secondary',
            )}
          >
            {line.content}
          </div>
        ))}
      </div>
    </div>
  )
}
