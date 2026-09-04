import type { JsonObject } from '@shared/types/json'
import { AlertCircle, Clipboard } from 'lucide-react'
import { lazy, Suspense } from 'react'
import {
  FILE_CONTENT_ARG_KEYS,
  getToolResultText,
  inferLanguageFromPath,
  LONG_ARGUMENT_MAX_HEIGHT_PX,
  LONG_ARGUMENT_PREVIEW_CHARS,
  RESULT_MAX_HEIGHT_PX,
  shouldHighlightCode,
  type UnifiedDiffData,
} from '@/features/chat/lib/tool-call-block'
import { usePreferencesStore } from '@/features/settings'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { SourceView } from '@/shared/ui/SourceView'
import { StructuredPayload, serializeStructuredPayload } from '@/shared/ui/StructuredPayload'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { useChatDisplayText, useChatDisplayTextFormatter } from './ChatDisplayPathContext'

const LazyDiffBlock = lazy(() =>
  import('@/shared/ui/DiffBlock').then(({ DiffBlock }) => ({ default: DiffBlock })),
)

export function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const { copied, copy } = useCopyToClipboard()
  if (!value) {
    return null
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
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
  const displayRawArgs = useChatDisplayText(rawArgs)
  const displayCommand = useChatDisplayText(typeof args.command === 'string' ? args.command : '')
  if (name === 'bash' && typeof args.command === 'string') {
    return (
      <SyntaxBlock
        source={`$ ${displayCommand}`}
        language="bash"
        ariaLabel="Shell command"
        className="rounded-md text-sm"
      />
    )
  }

  const entries = Object.entries(args)
  if (entries.length === 0) {
    return (
      <SyntaxBlock source={displayRawArgs || '{}'} language="json" className="rounded-md bg-bg" />
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
  const serialized = typeof value === 'string' ? value : serializeStructuredPayload(value)
  const displayText = useChatDisplayText(typeof serialized === 'string' ? serialized : '')

  if (typeof value !== 'string') {
    return (
      <div>
        <span className="text-sm text-text-tertiary">{name}: </span>
        <StructuredPayload
          value={value}
          serialized={serialized}
          className="mt-0.5 max-h-50 bg-bg"
        />
      </div>
    )
  }
  const display = FILE_CONTENT_ARG_KEYS.has(name) && typeof value === 'string' ? value : displayText
  const isLong = typeof display === 'string' && display.length > LONG_ARGUMENT_PREVIEW_CHARS

  return (
    <div>
      <span className="text-sm text-text-tertiary">{name}: </span>
      {isLong && typeof value === 'string' && FILE_CONTENT_ARG_KEYS.has(name) ? (
        <HighlightedFileContent
          content={value}
          language={inferLanguageFromPath(path)}
          maxHeight={LONG_ARGUMENT_MAX_HEIGHT_PX}
        />
      ) : isLong ? (
        <PlainTextBlock reason="prose" className="mt-0.5 max-h-50 text-sm">
          {display ?? ''}
        </PlainTextBlock>
      ) : (
        <span className="text-sm font-mono text-text-secondary">{display}</span>
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
      <div className="space-y-1">
        <p className="text-xs text-text-muted">
          Large file preview uses viewport-only highlighting to keep the UI responsive.
        </p>
        <div style={{ height: maxHeight, maxHeight }}>
          <SourceView
            source={content}
            language={language}
            ariaLabel="Large file source preview"
            className="h-full rounded-md bg-bg text-sm leading-relaxed"
          />
        </div>
      </div>
    )
  }
  return (
    <div className="tool-result-code overflow-y-auto" style={{ maxHeight }}>
      <SyntaxBlock
        source={content}
        language={language}
        className="rounded-md bg-bg text-sm leading-relaxed"
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
  const serializedContent =
    typeof content === 'string' ? content : serializeStructuredPayload(content)
  const displayContent = getToolResultText(content, serializedContent)
  const shortenedContent = useChatDisplayText(displayContent)

  if (isError) {
    return (
      <div className="rounded-md border border-error/20 bg-error/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="size-3.5 text-error shrink-0 mt-0.5" />
          <PlainTextBlock reason="error" className="flex-1 bg-transparent p-0 text-sm text-error">
            {shortenedContent}
          </PlainTextBlock>
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

  if (typeof content !== 'string' && displayContent === serializedContent) {
    return (
      <StructuredPayload
        value={content}
        serialized={serializedContent}
        className="max-h-75 bg-bg"
      />
    )
  }

  return (
    <PlainTextBlock reason="prose" className="max-h-75 text-sm">
      {shortenedContent}
    </PlainTextBlock>
  )
}

export function UnifiedDiffView({
  diff,
  compact = false,
}: {
  readonly diff: UnifiedDiffData
  readonly compact?: boolean
}) {
  const formatDisplayText = useChatDisplayTextFormatter()
  const view = usePreferencesStore((state) => state.settings.diffView)
  const wrap = usePreferencesStore((state) => state.settings.diffWrapLines)
  const { shikiTheme } = useSyntaxTheme()
  const displayPatch = diff.lines
    .map((line) => (line.type === 'meta' ? formatDisplayText(line.content) : line.content))
    .join('\n')
  return (
    <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
      <div className="flex items-center justify-between bg-bg-secondary px-3 py-1.5 border-b border-border">
        <span className="text-text-secondary">Diff</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {diff.additions > 0 && <span className="text-success">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="text-error">-{diff.deletions}</span>}
        </div>
      </div>
      <Suspense
        fallback={
          <div
            aria-label="Loading diff"
            className="h-24 animate-pulse bg-bg-secondary/60"
            role="status"
          />
        }
      >
        <LazyDiffBlock
          patch={displayPatch}
          className={compact ? 'max-h-55 overflow-y-hidden' : undefined}
          view={view}
          wrap={wrap}
          theme={shikiTheme}
        />
      </Suspense>
    </div>
  )
}
