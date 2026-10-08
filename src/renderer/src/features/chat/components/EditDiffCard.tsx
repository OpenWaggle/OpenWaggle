import { FileText } from 'lucide-react'
import { Component, lazy, type ReactNode, Suspense } from 'react'
import type { EditDiffData } from '@/features/chat/lib/tool-call-block'
import { usePreferencesStore } from '@/features/settings/state'
import { useOpenWorkspaceFile } from '@/features/workspace-files/hooks'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { useChatDisplayText, useChatWorkspaceRelativePath } from './ChatDisplayPathContext'
import { DiffStatLabel } from './DiffStatLabel'
import { CopyButton } from './ToolCallBlockParts'

const LazyDiffBlock = lazy(() =>
  import('@/shared/ui/DiffBlock').then(({ DiffBlock }) => ({ default: DiffBlock })),
)

/** Codex caps an inline file diff at 15rem and scrolls the rest (ADR 0050). */
const EDIT_DIFF_BODY_CLASS = 'max-h-60'

const logger = createRendererLogger('EditDiffCard')

/**
 * A diff that cannot render (a patch Pierre rejects, a failed chunk load) falls back to
 * the diff as text inside its own row instead of taking down the whole transcript.
 */
class EditDiffRenderBoundary extends Component<
  { readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error) {
    logger.warn('Edit diff failed to render; showing it as text', { message: error.message })
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function basename(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

/**
 * The expanded body of a successful edit row: a header naming the file with its
 * +/- counts and copy actions, then the file's diff (ADR 0050).
 */
export function EditDiffCard({
  diff,
  path,
  args,
}: {
  readonly diff: EditDiffData
  readonly path: string | null
  readonly args: string
}) {
  return (
    <div className="ml-5 mt-1 overflow-hidden rounded-md border border-border bg-bg-secondary/50">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-text-tertiary">
        <div className="flex min-w-0 items-center gap-2">
          {path && <EditDiffFileName path={path} line={diff.firstChangedLine} />}
          <DiffStatLabel additions={diff.additions} deletions={diff.deletions} layout="inline" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton label="Copy diff" value={diff.text} />
          {path && <CopyButton label="Copy path" value={path} />}
          <CopyButton label="Copy args" value={args} />
        </div>
      </div>
      <EditDiffBody diff={diff} />
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
    <EditDiffRenderBoundary fallback={text}>
      <Suspense
        fallback={
          <div role="status" className="h-24 animate-pulse bg-bg/60 motion-reduce:animate-none">
            <span className="sr-only">Loading diff…</span>
          </div>
        }
      >
        <LazyDiffBlock patch={diff.patch} view="unified" wrap={wrap} theme={shikiTheme} embedded />
      </Suspense>
    </EditDiffRenderBoundary>
  )
}

function EditDiffText({ text, wrap }: { readonly text: string; readonly wrap: boolean }) {
  return (
    <SyntaxBlock
      source={text}
      language="diff"
      wrap={wrap}
      ariaLabel="Edit diff"
      className={`${EDIT_DIFF_BODY_CLASS} rounded-none bg-bg text-xs`}
    />
  )
}
