import type { JsonObject } from '@shared/types/json'
import { AlertCircle, Clipboard } from 'lucide-react'
import {
  buildFencedCodeMarkdown,
  FILE_CONTENT_ARG_KEYS,
  getToolResultText,
  getUnifiedDiffLineClassName,
  inferLanguageFromPath,
  JSON_STRINGIFY_SPACES,
  LONG_ARGUMENT_MAX_HEIGHT_PX,
  LONG_ARGUMENT_PREVIEW_CHARS,
  RESULT_MAX_HEIGHT_PX,
  shouldHighlightCode,
  type UnifiedDiffData,
} from '@/features/chat/lib/tool-call-block'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { StreamingText } from './StreamingText'

export function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const { copied, copy } = useCopyToClipboard()
  if (!value) {
    return null
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      onClick={(event) => {
        event.stopPropagation()
        copy(value)
      }}
    >
      <Clipboard className="size-3" />
      {copied ? 'Copied' : label}
    </Button>
  )
}

export function ToolArgs({
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
      {entries.map(([key, value]) => (
        <ToolArgValue key={key} name={key} value={value} path={path} />
      ))}
    </div>
  )
}

function ToolArgValue({
  name,
  value,
  path,
}: {
  name: string
  value: unknown
  path: string | null
}) {
  const display =
    typeof value === 'string' ? value : JSON.stringify(value, null, JSON_STRINGIFY_SPACES)
  const isLong = typeof display === 'string' && display.length > LONG_ARGUMENT_PREVIEW_CHARS

  return (
    <div>
      <span className="text-[13px] text-text-tertiary">{name}: </span>
      {isLong && typeof value === 'string' && FILE_CONTENT_ARG_KEYS.has(name) ? (
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
  if (!shouldHighlightCode(content)) {
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

export function ToolResult({
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
          <AlertCircle className="size-3.5 text-error shrink-0 mt-0.5" />
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

export function UnifiedDiffView({
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
            className={cn('flex whitespace-pre px-3', getUnifiedDiffLineClassName(line.type))}
          >
            {line.content}
          </div>
        ))}
      </div>
    </div>
  )
}
