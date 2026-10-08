import { FileText } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { EditDiffData } from '@/features/chat/lib/tool-call-block'
import { usePreferencesStore } from '@/features/settings/state'
import { useOpenWorkspaceFile } from '@/features/workspace-files/hooks'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { RenderErrorBoundary } from '@/shared/ui/RenderErrorBoundary'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { useChatDisplayText, useChatWorkspaceRelativePath } from './ChatDisplayPathContext'
import { DiffStatLabel } from './DiffStatLabel'
import { CopyButton } from './ToolCallBlockParts'

// A failed chunk load stays cached by `lazy`, so every edit row then shows its diff as
// text until the renderer reloads; the row's boundary keeps that failure local.
const LazyDiffBlock = lazy(() =>
  import('@/shared/ui/DiffBlock').then(({ DiffBlock }) => ({ default: DiffBlock })),
)

/**
 * Codex caps an inline file diff at 15rem and scrolls the rest (ADR 0050). The Pierre
 * path applies the same cap inside `DiffBlock`'s embedded mode.
 */
const EDIT_DIFF_BODY_CLASS = 'max-h-60'

function basename(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

/**
 * The expanded body of a successful edit row: a header naming the file with its
 * +/- counts and copy actions, then the file's diff (ADR 0050).
 */
export function EditRowDiff({
  diff,
  path,
  args,
  output,
}: {
  readonly diff: EditDiffData
  readonly path: string | null
  readonly args: string
  /** Result text the diff does not already convey (`getEditExtraOutput`). */
  readonly output: string
}) {
  return (
    <div className="ml-5 mt-1 overflow-hidden rounded-md border border-border bg-bg-secondary/50">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border px-3 py-1.5 text-xs text-text-tertiary">
        <div className="flex min-w-0 items-center gap-2">
          {path && <EditDiffFileName path={path} line={diff.firstChangedLine} />}
          <DiffStatLabel additions={diff.additions} deletions={diff.deletions} layout="inline" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton label="Copy diff" value={diff.text} />
          {path && <CopyButton label="Copy path" value={path} />}
          <CopyButton label="Copy args" value={args} />
          <CopyButton label="Copy output" value={output} />
        </div>
      </div>
      <section aria-label={path ? `Diff of ${basename(path)}` : 'Edit diff'}>
        <EditDiffBody diff={diff} />
      </section>
      {output && <EditRowOutput text={output} />}
    </div>
  )
}

function EditRowOutput({ text }: { readonly text: string }) {
  const displayText = useChatDisplayText(text)
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-1 text-sm text-text-tertiary">Output</div>
      <PlainTextBlock reason="log" className="max-h-50 text-sm">
        {displayText}
      </PlainTextBlock>
    </div>
  )
}

function EditDiffFileName({ path, line }: { readonly path: string; readonly line: number | null }) {
  const openWorkspaceFile = useOpenWorkspaceFile()
  const displayPath = useChatDisplayText(path)
  const relativePath = useChatWorkspaceRelativePath(path)
  const label = (
    <>
      <FileText className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate font-mono">{basename(displayPath)}</span>
    </>
  )

  if (relativePath === null) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-text-secondary" title={displayPath}>
        {label}
      </span>
    )
  }
  return (
    <Button
      variant="unstyled"
      type="button"
      title={displayPath}
      aria-label={`Open ${displayPath}`}
      className="flex min-w-0 items-center gap-1 text-text-secondary transition-colors hover:text-text-primary hover:underline"
      onClick={() => openWorkspaceFile(relativePath, line)}
    >
      {label}
    </Button>
  )
}

function EditDiffBody({ diff }: { readonly diff: EditDiffData }) {
  const wrap = usePreferencesStore((state) => state.settings.diffWrapLines)
  const { shikiTheme } = useSyntaxTheme()
  const text = <EditDiffText text={diff.text} wrap={wrap} />

  if (diff.patch === null) {
    // Edits recorded before Pi sent a unified patch only carry its line-numbered
    // display diff, which Pierre cannot parse; show it as highlighted text.
    return text
  }

  return (
    <RenderErrorBoundary name="Edit diff" fallback={text}>
      <Suspense
        fallback={
          <div role="status" className="h-24 animate-pulse bg-bg/60 motion-reduce:animate-none">
            <span className="sr-only">Loading diff…</span>
          </div>
        }
      >
        <LazyDiffBlock patch={diff.patch} view="unified" wrap={wrap} theme={shikiTheme} embedded />
      </Suspense>
    </RenderErrorBoundary>
  )
}

function EditDiffText({ text, wrap }: { readonly text: string; readonly wrap: boolean }) {
  return (
    <SyntaxBlock
      source={text}
      language="diff"
      wrap={wrap}
      className={`${EDIT_DIFF_BODY_CLASS} rounded-none bg-bg text-xs`}
    />
  )
}
