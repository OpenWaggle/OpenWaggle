import { DOUBLE_FACTOR } from '@shared/constants/math'
import type { ReviewComment } from '@shared/types/review'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { Button } from '@/shared/ui/Button'
import { CollapsedLines } from './CollapsedLines'
import { DiffLine } from './DiffLine'
import { InlineComment } from './InlineComment'

const PARSE_INT_ARG_2 = 10
const FLUSH_CONTEXT_VALUE_6 = 6
const SLICE_ARG_2 = 3
const SLICE_ARG_1 = 3
const SLICE_ARG_2_NEGATIVE_3 = -3
const SLICE_ARG_1_NEGATIVE_3 = -3

export interface ParsedLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNumber: number | null
}

export type DisplayItem =
  | { kind: 'line'; line: ParsedLine; index: number }
  | { kind: 'collapsed'; lines: ParsedLine[]; key: string }

interface DiffCursor {
  oldLine: number
  newLine: number
  headerSeen: boolean
}

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

function shouldSkipDiffMetadataLine(line: string) {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('---') ||
    line.startsWith('+++') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('similarity') ||
    line.startsWith('rename')
  )
}

function readHunkHeader(line: string, cursor: DiffCursor) {
  const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!hunkMatch) {
    return false
  }

  cursor.oldLine = Number.parseInt(hunkMatch[1] ?? '1', PARSE_INT_ARG_2)
  cursor.newLine = Number.parseInt(hunkMatch[DOUBLE_FACTOR] ?? '1', PARSE_INT_ARG_2)
  cursor.headerSeen = true
  return true
}

function parseDiffContentLine(line: string, cursor: DiffCursor): ParsedLine | null {
  if (!cursor.headerSeen) return null

  if (line.startsWith('+')) {
    const parsed: ParsedLine = { type: 'add', content: line.slice(1), lineNumber: cursor.newLine }
    cursor.newLine += 1
    return parsed
  }

  if (line.startsWith('-')) {
    const parsed: ParsedLine = {
      type: 'remove',
      content: line.slice(1),
      lineNumber: cursor.oldLine,
    }
    cursor.oldLine += 1
    return parsed
  }

  if (!line.startsWith(' ') && line !== '') return null

  const parsed: ParsedLine = {
    type: 'context',
    content: line.startsWith(' ') ? line.slice(1) : '',
    lineNumber: cursor.newLine,
  }
  cursor.oldLine += 1
  cursor.newLine += 1
  return parsed
}

function parseRawDiff(diff: string) {
  const displayLines: ParsedLine[] = []
  const cursor = { oldLine: 0, newLine: 0, headerSeen: false }

  for (const line of diff.split('\n')) {
    if (shouldSkipDiffMetadataLine(line) || readHunkHeader(line, cursor)) continue
    const parsedLine = parseDiffContentLine(line, cursor)
    if (parsedLine) displayLines.push(parsedLine)
  }
  return displayLines
}

export function buildDisplayItems(diff: string): DisplayItem[] {
  const displayLines = parseRawDiff(diff)
  const items: DisplayItem[] = []
  let contextBuffer: ParsedLine[] = []
  let lineIdx = 0

  function flushContext() {
    if (contextBuffer.length === 0) return
    if (contextBuffer.length <= FLUSH_CONTEXT_VALUE_6) {
      for (const line of contextBuffer) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
    } else {
      for (const line of contextBuffer.slice(0, SLICE_ARG_2)) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
      const key = `collapsed-${lineIdx}`
      items.push({
        kind: 'collapsed',
        lines: contextBuffer.slice(SLICE_ARG_1, SLICE_ARG_2_NEGATIVE_3),
        key,
      })
      lineIdx += contextBuffer.length - FLUSH_CONTEXT_VALUE_6
      for (const line of contextBuffer.slice(SLICE_ARG_1_NEGATIVE_3)) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
    }
    contextBuffer = []
  }

  for (const line of displayLines) {
    if (line.type === 'context') {
      contextBuffer.push(line)
      continue
    }
    flushContext()
    items.push({ kind: 'line', line, index: lineIdx++ })
  }

  flushContext()
  return items
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
