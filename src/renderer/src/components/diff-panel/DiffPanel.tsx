import type { GitFileDiff } from '@shared/types/git'
import type { ReviewComment } from '@shared/types/review'
import { chooseBy } from '@shared/utils/decision'
import { useEffect, useReducer } from 'react'
import { Spinner } from '@/components/shared/Spinner'
import { api } from '@/lib/ipc'
import { useReviewStore } from '@/stores/review-store'
import { DiffBottomBar } from './DiffBottomBar'
import { buildDisplayItems, DiffFileSection, type DisplayItem } from './DiffFileSection'
import { FileTree } from './FileTree'

interface DiffPanelProps {
  projectPath: string | null
  onSendMessage: (content: string) => void
}

interface RenderableDiffFile extends GitFileDiff {
  readonly items: DisplayItem[]
}

interface DiffPanelState {
  readonly fileDiffs: RenderableDiffFile[]
  readonly isLoading: boolean
}

type DiffPanelAction =
  | { readonly type: 'clear' }
  | { readonly type: 'start-loading' }
  | { readonly type: 'load-success'; readonly fileDiffs: RenderableDiffFile[] }
  | { readonly type: 'load-failure' }

function diffPanelReducer(state: DiffPanelState, action: DiffPanelAction): DiffPanelState {
  return chooseBy(action, 'type')
    .case('clear', () => ({ fileDiffs: [], isLoading: false }))
    .case('start-loading', () => ({ ...state, isLoading: true }))
    .case('load-success', (value) => ({ fileDiffs: value.fileDiffs, isLoading: false }))
    .case('load-failure', () => ({ fileDiffs: [], isLoading: false }))
    .assertComplete()
}

export function DiffPanel({ projectPath, onSendMessage }: DiffPanelProps) {
  const [state, dispatch] = useReducer(diffPanelReducer, {
    fileDiffs: [],
    isLoading: false,
  })

  const comments = useReviewStore((s) => s.comments)
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const addComment = useReviewStore((s) => s.addComment)
  const clearComments = useReviewStore((s) => s.clearComments)

  useEffect(() => {
    if (!projectPath) {
      dispatch({ type: 'clear' })
      return
    }

    dispatch({ type: 'start-loading' })
    let cancelled = false
    api
      .getGitDiff(projectPath)
      .then((diffs) => {
        if (cancelled) return
        dispatch({
          type: 'load-success',
          fileDiffs: diffs.map((diff) => ({
            ...diff,
            items: buildDisplayItems(diff.diff),
          })),
        })
      })
      .catch(() => {
        if (cancelled) return
        dispatch({ type: 'load-failure' })
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  const { fileDiffs, isLoading } = state

  function handleAddSingleComment(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
  ): void {
    const lineRef =
      startLine !== endLine ? `s ${String(startLine)}-${String(endLine)}` : ` ${String(startLine)}`
    const message = `**Review comment** on \`${filePath}\` (line${lineRef}):\n\n${content}`
    onSendMessage(message)
    setActiveCommentLocation(null)
  }

  function handleAddToReview(comment: ReviewComment): void {
    addComment(comment)
  }

  function handleSendReview(): void {
    if (comments.length === 0) return

    const lines = comments.map((c) => {
      const lineRef =
        c.startLine !== c.endLine
          ? `s ${String(c.startLine)}-${String(c.endLine)}`
          : ` ${String(c.startLine)}`
      return `- **\`${c.filePath}\`** line${lineRef}: ${c.content}`
    })
    const message = `**Code Review**\n\n${lines.join('\n')}`
    onSendMessage(message)
    clearComments()
  }

  function handleFileClick(path: string): void {
    const el = document.getElementById(`diff-file-${path}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleRevertAll(): void {
    // Future: implement git checkout -- . via IPC
  }

  function handleStageAll(): void {
    // Future: implement git add -A via IPC
  }

  return (
    <div className="flex flex-col h-full w-full bg-diff-bg">
      {/* Main split: diff area + file tree */}
      <div className="flex flex-1 overflow-hidden">
        {/* Diff Area */}
        <div className="diff-scroll flex-1 overflow-auto p-2.5">
          <div className="flex min-w-full w-max flex-col gap-2.5">
            {isLoading && (
              <div className="flex items-center justify-center h-20 text-text-tertiary">
                <Spinner />
              </div>
            )}
            {!isLoading && fileDiffs.length === 0 && (
              <div className="flex items-center justify-center h-20 text-[12px] text-text-tertiary">
                No uncommitted changes
              </div>
            )}
            {fileDiffs.map((file) => (
              <div key={file.path} id={`diff-file-${file.path}`}>
                <DiffFileSection
                  filePath={file.path}
                  items={file.items}
                  additions={file.additions}
                  deletions={file.deletions}
                  activeCommentLocation={activeCommentLocation}
                  onSetActiveComment={setActiveCommentLocation}
                  onAddSingleComment={handleAddSingleComment}
                  onAddToReview={handleAddToReview}
                />
              </div>
            ))}
          </div>
        </div>

        {/* File Tree */}
        <FileTree
          files={fileDiffs}
          onFileClick={handleFileClick}
          onSendReview={handleSendReview}
          reviewCount={comments.length}
        />
      </div>

      {/* Bottom Bar */}
      <DiffBottomBar
        onRevertAll={handleRevertAll}
        onStageAll={handleStageAll}
        hasChanges={fileDiffs.length > 0}
      />
    </div>
  )
}
