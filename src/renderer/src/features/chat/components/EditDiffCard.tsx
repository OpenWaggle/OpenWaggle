import { FileText } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { EditDiffData } from '@/features/chat/lib/tool-call-block'
import { usePreferencesStore } from '@/features/settings'
import { useOpenWorkspaceFile } from '@/features/workspace-files/hooks'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
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
      onClick={(event) => {
        event.stopPropagation()
        openWorkspaceFile(relativePath, line)
      }}
    >
      {label}
    </Button>
  )
}

function EditDiffBody({ diff }: { readonly diff: EditDiffData }) {
  const wrap = usePreferencesStore((state) => state.settings.diffWrapLines)
  const { shikiTheme } = useSyntaxTheme()

  if (diff.patch === null) {
    // Edits recorded before Pi sent a unified patch only carry its line-numbered
    // display diff, which Pierre cannot parse; show it as highlighted text.
    return (
      <div className={`${EDIT_DIFF_BODY_CLASS} overflow-y-auto`}>
        <SyntaxBlock
          source={diff.text}
          language="diff"
          wrap={wrap}
          ariaLabel="Edit diff"
          className="rounded-none bg-bg text-xs"
        />
      </div>
    )
  }

  return (
    <Suspense
      fallback={
        <div aria-label="Loading diff" className="h-24 animate-pulse bg-bg/60" role="status" />
      }
    >
      <LazyDiffBlock
        patch={diff.patch}
        view="unified"
        wrap={wrap}
        theme={shikiTheme}
        embedded
        className={`${EDIT_DIFF_BODY_CLASS} text-xs`}
      />
    </Suspense>
  )
}
