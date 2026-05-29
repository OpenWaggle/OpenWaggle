import type { ReviewComment } from '@shared/types/review'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { Button } from '@/shared/ui/Button'
import { CollapsedLines } from './CollapsedLines'
import { DiffLine } from './DiffLine'
import type { DisplayItem } from './diff-display-items'
import { InlineComment } from './InlineComment'

function createLineReviewComment(filePath: string, lineNum: number, content: string) {
  const createdAt = Math.trunc(performance.timeOrigin + performance.now())
  return {
    id: `${filePath}:${String(lineNum)}-${String(createdAt)}`,
    filePath,
    startLine: lineNum,
    endLine: lineNum,
    content,
    createdAt,
  }
}

interface DiffFileSectionProps {
  filePath: string
  items: DisplayItem[]
  additions: number
  deletions: number
  activeCommentLocation: ReviewCommentLocation | null
  onSetActiveComment: (location: ReviewCommentLocation | null) => void
  onAddSingleComment: (
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
  ) => void
  onAddToReview: (comment: ReviewComment) => void
}

export function DiffFileSection({
  filePath,
  items,
  additions,
  deletions,
  activeCommentLocation,
  onSetActiveComment,
  onAddSingleComment,
  onAddToReview,
}: DiffFileSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const [expandedCollapsed, setExpandedCollapsed] = useState<Record<string, boolean>>({})

  const isCommentActiveHere = activeCommentLocation?.filePath === filePath

  const ChevIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="min-w-full w-max rounded-lg border border-diff-file-border bg-diff-file-bg overflow-hidden shadow-[0_1px_3px_#00000055]">
      {/* File Header — h34, bg #111418 */}
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full h-[34px] px-3 bg-diff-header-bg"
      >
        <div className="flex items-center gap-1.5">
          <ChevIcon className="size-[13px] text-text-tertiary shrink-0" />
          <span className="text-[12px] font-medium text-text-primary">{filePath}</span>
        </div>
        <div className="flex items-center gap-1">
          {additions > 0 && (
            <span className="text-[11px] font-semibold text-accent">+{additions}</span>
          )}
          {deletions > 0 && (
            <span className="text-[11px] font-semibold text-error">-{deletions}</span>
          )}
        </div>
      </Button>

      {/* Diff lines */}
      {expanded && (
        <div className="w-full">
          {items.map((item) => {
            if (item.kind === 'collapsed') {
              const isExpanded = expandedCollapsed[item.key] ?? false
              if (isExpanded) {
                return item.lines.map((line, i) => (
                  <DiffLine
                    key={`${item.key}-${String(i)}`}
                    type={line.type}
                    lineNumber={line.lineNumber}
                    content={line.content}
                    isSelected={false}
                    onClick={() =>
                      onSetActiveComment(
                        isCommentActiveHere &&
                          activeCommentLocation?.line === line.lineNumber &&
                          activeCommentLocation.lineType === line.type
                          ? null
                          : { filePath, line: line.lineNumber ?? 0, lineType: line.type },
                      )
                    }
                  />
                ))
              }
              return (
                <CollapsedLines
                  key={item.key}
                  count={item.lines.length}
                  onClick={() => setExpandedCollapsed((prev) => ({ ...prev, [item.key]: true }))}
                />
              )
            }

            const { line } = item
            const lineNum = line.lineNumber ?? 0
            const isSelected =
              isCommentActiveHere &&
              activeCommentLocation?.line === lineNum &&
              activeCommentLocation.lineType === line.type
            return (
              <div key={`line-${String(item.index)}`}>
                <DiffLine
                  type={line.type}
                  lineNumber={line.lineNumber}
                  content={line.content}
                  isSelected={isSelected}
                  onClick={() =>
                    onSetActiveComment(
                      isSelected ? null : { filePath, line: lineNum, lineType: line.type },
                    )
                  }
                />
                {isSelected && (
                  <InlineComment
                    startLine={lineNum}
                    endLine={lineNum}
                    onAddSingleComment={(content) =>
                      onAddSingleComment(filePath, lineNum, lineNum, content)
                    }
                    onAddToReview={(content) => {
                      onAddToReview(createLineReviewComment(filePath, lineNum, content))
                      onSetActiveComment(null)
                    }}
                    onCancel={() => onSetActiveComment(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
