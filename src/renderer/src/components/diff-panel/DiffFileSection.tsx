import type { ReviewComment } from '@shared/types/review'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { CollapsedLines } from './CollapsedLines'
import { DiffLine } from './DiffLine'
import { InlineComment } from './InlineComment'

interface ParsedLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNumber: number | null
}

interface DiffFileSectionProps {
  filePath: string
  diff: string
  additions: number
  deletions: number
  activeCommentLocation: { filePath: string; line: number } | null
  onSetActiveComment: (location: { filePath: string; line: number } | null) => void
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
  diff,
  additions,
  deletions,
  activeCommentLocation,
  onSetActiveComment,
  onAddSingleComment,
  onAddToReview,
}: DiffFileSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [expandedCollapsed, setExpandedCollapsed] = useState<Record<string, boolean>>({})

  // Parse the raw diff into displayable lines
  const rawLines = diff.split('\n')
  const displayLines: ParsedLine[] = []
  let oldLine = 0
  let newLine = 0
  let headerSeen = false

  for (const line of rawLines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity') ||
      line.startsWith('rename')
    ) {
      continue
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1] ?? '1', 10)
      newLine = Number.parseInt(hunkMatch[2] ?? '1', 10)
      headerSeen = true
      continue
    }

    if (!headerSeen) continue

    if (line.startsWith('+')) {
      displayLines.push({ type: 'add', content: line.slice(1), lineNumber: newLine })
      newLine++
    } else if (line.startsWith('-')) {
      displayLines.push({ type: 'remove', content: line.slice(1), lineNumber: oldLine })
      oldLine++
    } else if (line.startsWith(' ') || (headerSeen && line === '')) {
      displayLines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : '',
        lineNumber: newLine,
      })
      oldLine++
      newLine++
    }
  }

  // Group context lines into collapsed sections
  type DisplayItem =
    | { kind: 'line'; line: ParsedLine; index: number }
    | { kind: 'collapsed'; lines: ParsedLine[]; key: string }

  const items: DisplayItem[] = []
  let contextBuffer: ParsedLine[] = []
  let lineIdx = 0

  function flushContext(): void {
    if (contextBuffer.length === 0) return
    if (contextBuffer.length <= 6) {
      // Show short context directly
      for (const l of contextBuffer) {
        items.push({ kind: 'line', line: l, index: lineIdx++ })
      }
    } else {
      // Show first 3, collapsed middle, last 3
      for (const l of contextBuffer.slice(0, 3)) {
        items.push({ kind: 'line', line: l, index: lineIdx++ })
      }
      const key = `collapsed-${lineIdx}`
      items.push({ kind: 'collapsed', lines: contextBuffer.slice(3, -3), key })
      lineIdx += contextBuffer.length - 6
      for (const l of contextBuffer.slice(-3)) {
        items.push({ kind: 'line', line: l, index: lineIdx++ })
      }
    }
    contextBuffer = []
  }

  for (const line of displayLines) {
    if (line.type === 'context') {
      contextBuffer.push(line)
    } else {
      flushContext()
      items.push({ kind: 'line', line, index: lineIdx++ })
    }
  }
  flushContext()

  const isCommentActiveHere = activeCommentLocation?.filePath === filePath

  const ChevIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="w-full rounded-lg border border-diff-file-border bg-diff-file-bg overflow-hidden shadow-[0_1px_3px_#00000055]">
      {/* File Header — h34, bg #111418 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full h-[34px] px-3 bg-diff-header-bg"
      >
        <div className="flex items-center gap-1.5">
          <ChevIcon className="h-[13px] w-[13px] text-text-tertiary shrink-0" />
          <span className="text-[11px] font-medium text-text-primary">{filePath}</span>
        </div>
        <div className="flex items-center gap-1">
          {additions > 0 && (
            <span className="text-[10px] font-semibold text-accent">+{additions}</span>
          )}
          {deletions > 0 && (
            <span className="text-[10px] font-semibold text-error">-{deletions}</span>
          )}
        </div>
      </button>

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
                        isCommentActiveHere && activeCommentLocation?.line === line.lineNumber
                          ? null
                          : { filePath, line: line.lineNumber ?? 0 },
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
            const isSelected = isCommentActiveHere && activeCommentLocation?.line === lineNum
            return (
              <div key={`line-${String(item.index)}`}>
                <DiffLine
                  type={line.type}
                  lineNumber={line.lineNumber}
                  content={line.content}
                  isSelected={isSelected}
                  onClick={() =>
                    onSetActiveComment(isSelected ? null : { filePath, line: lineNum })
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
                      onAddToReview({
                        id: `${filePath}:${String(lineNum)}-${Date.now()}`,
                        filePath,
                        startLine: lineNum,
                        endLine: lineNum,
                        content,
                        createdAt: Date.now(),
                      })
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
