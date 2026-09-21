import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary, TurnDiffFileSummary } from '@shared/types/turn-diff'
import { ChevronRight, FileDiff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import {
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
  summarizeTurnDiffStats,
} from '../lib/changed-files-presentation'
import { changedFilesCardKey, useChangedFilesCardStore } from '../state/changed-files-card-store'
import { ChangedFilesTree } from './ChangedFilesTree'
import { DiffStatLabel, hasNonZeroStat } from './DiffStatLabel'

const EMPTY_FILES: readonly TurnDiffFileSummary[] = []
const logger = createRendererLogger('changed-files-card')

interface ChangedFilesCardProps {
  readonly sessionId: SessionId | null
  /** The turn checkpoint anchored to this terminal message. */
  readonly turn: TurnCheckpointSummary
  readonly isLatestTurn: boolean
  readonly anchorMessageId: string
  readonly onOpenTurnDiff: (messageId: string, filePath?: string) => void
}

/** Compact preview of a collapsed card: directory scopes plus representative file chips. */
function CollapsedPreview({
  files,
  anchorMessageId,
  onOpenTurnDiff,
  onExpand,
}: {
  readonly files: readonly TurnDiffFileSummary[]
  readonly anchorMessageId: string
  readonly onOpenTurnDiff: (messageId: string, filePath?: string) => void
  readonly onExpand: () => void
}) {
  const scopeSummary = summarizeChangedFileScopes(files)
  const previewFiles = selectChangedFilePreview(files)

  return (
    <div className="px-2 pb-1.5 pt-1">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-tertiary">
        {scopeSummary.map((scope, index) => (
          <span key={scope.label} className="inline-flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span className="font-mono text-text-secondary">{scope.label}</span>
            <span>
              {scope.fileCount} {scope.fileCount === 1 ? 'file' : 'files'}
            </span>
          </span>
        ))}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {previewFiles.map((file) => (
          <Button
            key={file.path}
            variant="unstyled"
            type="button"
            onClick={() => onOpenTurnDiff(anchorMessageId, file.path)}
            title={file.path}
            className="inline-flex max-w-48 items-center rounded-md border border-border bg-bg/45 px-1.5 py-1 font-mono text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <span className="truncate">{changedFileName(file.path)}</span>
          </Button>
        ))}
        <Button
          variant="unstyled"
          type="button"
          onClick={onExpand}
          className="rounded-md px-1.5 py-1 text-xs font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          Show all {String(files.length)} files
        </Button>
      </div>
    </div>
  )
}

/**
 * Changed files card under a settled turn's terminal message (ADR 0034).
 * Mirrors the T3 Code card: quiet header with count + diff stat, compact scope
 * preview when collapsed, a directory-grouped tree when expanded; rows open the
 * Turn diff view focused on the file.
 */
export function ChangedFilesCard({
  sessionId,
  turn,
  isLatestTurn,
  anchorMessageId,
  onOpenTurnDiff,
}: ChangedFilesCardProps) {
  const [files, setFiles] = useState<readonly TurnDiffFileSummary[]>(EMPTY_FILES)
  const cardKey = changedFilesCardKey(sessionId, turn.turnId)
  const persistedExpanded = useChangedFilesCardStore((state) => state.expandedByCardKey[cardKey])
  const setExpanded = useChangedFilesCardStore((state) => state.setExpanded)
  const autoExpand = shouldAutoExpandChangedFiles(files, isLatestTurn)
  const expanded = persistedExpanded ?? autoExpand

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void (async () => {
      try {
        const files = await api.getTurnDiffFiles(sessionId, turn.turnId)
        if (!cancelled) setFiles(files)
      } catch (error) {
        logger.warn('Failed to load turn diff files', {
          message: error instanceof Error ? error.message : String(error),
          turnId: turn.turnId,
        })
        if (!cancelled) setFiles(EMPTY_FILES)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, turn.turnId])

  if (files.length === 0) return null

  const summaryStat = summarizeTurnDiffStats(files)

  return (
    <div
      data-testid="changed-files-card"
      className="@container/changed-files rounded-2xl border border-border bg-bg-secondary p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="unstyled"
          type="button"
          onClick={() => setExpanded(cardKey, !expanded)}
          aria-expanded={expanded}
          aria-controls={`${cardKey}-body`}
          className="group flex min-w-0 flex-1 items-center rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-text-tertiary transition-transform ${
                expanded ? 'rotate-90' : ''
              }`}
            />
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium leading-4 text-text-primary">
              <span>
                {files.length} changed file{files.length === 1 ? '' : 's'}
              </span>
              {hasNonZeroStat(summaryStat) ? (
                <DiffStatLabel
                  additions={summaryStat.additions}
                  deletions={summaryStat.deletions}
                  layout="inline"
                  className="text-xs leading-4"
                />
              ) : null}
            </span>
            <span className="ml-1 hidden min-w-0 flex-1 truncate text-xs text-text-tertiary group-hover:text-text-secondary @[24rem]/changed-files:inline">
              {expanded ? 'Hide files' : 'Show files'}
            </span>
          </span>
        </Button>
        <Button
          variant="secondary"
          size="xs"
          type="button"
          onClick={() => onOpenTurnDiff(anchorMessageId, files[0]?.path)}
          className="shrink-0"
          aria-label="Open diff"
        >
          <FileDiff className="size-3" />
          Open diff
        </Button>
      </div>

      {expanded ? (
        <div id={`${cardKey}-body`} className="mt-1">
          <ChangedFilesTree
            files={files}
            anchorMessageId={anchorMessageId}
            onOpenTurnDiff={onOpenTurnDiff}
          />
        </div>
      ) : isLatestTurn ? (
        <CollapsedPreview
          files={files}
          anchorMessageId={anchorMessageId}
          onOpenTurnDiff={onOpenTurnDiff}
          onExpand={() => setExpanded(cardKey, true)}
        />
      ) : null}
    </div>
  )
}
