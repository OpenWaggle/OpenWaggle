import type { GitFileDiff } from '@shared/types/git'
import type { ReviewComment } from '@shared/types/review'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'
import { useReviewStore } from '@/stores/review-store'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffFileSection } from './DiffFileSection'
import { FileTree } from './FileTree'

interface DiffPanelProps {
  projectPath: string | null
  onSendMessage: (content: string) => void
}

export function DiffPanel({ projectPath, onSendMessage }: DiffPanelProps): React.JSX.Element {
  const [fileDiffs, setFileDiffs] = useState<GitFileDiff[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const comments = useReviewStore((s) => s.comments)
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const addComment = useReviewStore((s) => s.addComment)
  const clearComments = useReviewStore((s) => s.clearComments)

  // Fetch diffs on mount, projectPath change, or explicit refresh from parent
  useEffect(() => {
    if (!projectPath) {
      setFileDiffs([])
      return
    }

    setIsLoading(true)
    api
      .getGitDiff(projectPath)
      .then((diffs) => setFileDiffs(diffs))
      .catch(() => setFileDiffs([]))
      .finally(() => setIsLoading(false))
  }, [projectPath])

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
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2.5">
          {isLoading && (
            <div className="flex items-center justify-center h-20 text-[11px] text-text-tertiary">
              Loading diffs…
            </div>
          )}
          {!isLoading && fileDiffs.length === 0 && (
            <div className="flex items-center justify-center h-20 text-[11px] text-text-tertiary">
              No uncommitted changes
            </div>
          )}
          {fileDiffs.map((file) => (
            <div key={file.path} id={`diff-file-${file.path}`}>
              <DiffFileSection
                filePath={file.path}
                diff={file.diff}
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
