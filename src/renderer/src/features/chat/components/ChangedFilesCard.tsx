import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary, TurnDiffFileSummary } from '@shared/types/turn-diff'
import { ChevronRight, FileDiff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import {
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
} from '../lib/changed-files-presentation'
import { changedFilesCardKey, useChangedFilesCardStore } from '../state/changed-files-card-store'

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
    <div className="mt-1.5">
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {previewFiles.map((file) => (
          <Button
            key={file.path}
            variant="unstyled"
            type="button"
            onClick={() => onOpenTurnDiff(anchorMessageId, file.path)}
            title={file.path}
            className="inline-flex max-w-48 items-center rounded-md border border-border px-1.5 py-0.5 font-mono text-xs text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-secondary"
          >
            <span className="truncate">{changedFileName(file.path)}</span>
          </Button>
        ))}
        <Button
          variant="unstyled"
          type="button"
          onClick={onExpand}
          className="rounded px-1.5 py-0.5 text-xs text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-secondary"
        >
          Show all {String(files.length)} files
        </Button>
      </div>
    </div>
  )
}

/**
 * Changed files card under a settled turn's terminal message (ADR 0033).
 * Mirrors the T3 Code card: quiet header, compact scope preview when collapsed,
 * one row per file when expanded; rows open the Turn diff view focused on the file.
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
  const autoExpand = useMemo(
    () => shouldAutoExpandChangedFiles(files, isLatestTurn),
    [files, isLatestTurn],
  )
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

  const additions = files.reduce((total, file) => total + file.additions, 0)
  const deletions = files.reduce((total, file) => total + file.deletions, 0)

  return (
    <div
      data-testid="changed-files-card"
      className="rounded-lg border border-border bg-bg-secondary px-2.5 py-2"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="unstyled"
          type="button"
          onClick={() => setExpanded(cardKey, !expanded)}
          aria-expanded={expanded}
          aria-controls={`${cardKey}-body`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-text-secondary"
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-text-tertiary transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span>Changed files</span>
          <span className="text-text-tertiary">
            · {files.length === 1 ? '1 file' : `${String(files.length)} files`}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs">
            <span className="text-diff-add-mark">+{String(additions)}</span>
            <span className="text-diff-remove-text">-{String(deletions)}</span>
          </span>
        </Button>
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onOpenTurnDiff(anchorMessageId, files[0]?.path)}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
          aria-label="Open turn diff"
        >
          <FileDiff className="size-3" />
          Turn diff
        </Button>
      </div>

      {expanded ? (
        <ul id={`${cardKey}-body`} className="mt-1.5 flex flex-col">
          {files.map((file) => (
            <li key={file.path}>
              <Button
                variant="unstyled"
                type="button"
                onClick={() => onOpenTurnDiff(anchorMessageId, file.path)}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary"
                title={file.path}
              >
                <span className="truncate font-mono">{changedFileName(file.path)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs">
                  {file.additions > 0 ? (
                    <span className="text-diff-add-mark">+{String(file.additions)}</span>
                  ) : null}
                  {file.deletions > 0 ? (
                    <span className="text-diff-remove-text">-{String(file.deletions)}</span>
                  ) : null}
                </span>
              </Button>
            </li>
          ))}
        </ul>
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
