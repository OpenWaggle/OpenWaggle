import type { SessionSummary } from '@shared/types/session'
import { CornerDownRight, GitBranch, ListTree, Split, Terminal } from 'lucide-react'
import { useSessionGitBranch } from '../hooks/useSessionGitIndicators'
import {
  buildSessionProvenance,
  type SessionProvenanceIndicator,
  type SessionProvenanceKind,
} from '../lib/session-provenance'

/**
 * One glyph per provenance concept, fixed by ADR 0020.
 *
 * Deliberately not the conventional git icons for worktree and clone. Four node-and-edge
 * glyphs from the same family are mutually unreadable at this size, so each concept takes
 * the most legible silhouette that nothing else in either icon family uses.
 */
const PROVENANCE_ICON: Record<
  SessionProvenanceKind,
  React.ComponentType<{ className?: string }>
> = {
  'git-branch': GitBranch,
  worktree: Split,
  'cloned-from': CornerDownRight,
  'conversation-branches': ListTree,
  terminal: Terminal,
}

function ProvenanceIndicator({ indicator }: { readonly indicator: SessionProvenanceIndicator }) {
  const Icon = PROVENANCE_ICON[indicator.kind]

  return (
    <span
      role="img"
      title={indicator.description}
      aria-label={indicator.description}
      className="flex h-4 shrink-0 items-center gap-0.5 text-text-tertiary"
    >
      <Icon className="size-2.5" />
      {indicator.count === undefined ? null : (
        <span className="text-xs tabular-nums">{indicator.count}</span>
      )}
    </span>
  )
}

/**
 * What kind of session this row describes: its branch, whether it owns a worktree, where it
 * came from, how many conversation branches it has, whether a terminal is alive.
 *
 * Always muted, never coloured. Colour in a row means "what this session needs from you",
 * and none of these facts need anything, so they never compete for that meaning.
 *
 * The branch name is not rendered. It was the widest thing on the second line and the user
 * can read it in the session itself, so it lives in the tooltip and the accessible name,
 * ready for a richer hover card later.
 */
export function SessionProvenanceIndicators({ session }: { readonly session: SessionSummary }) {
  const gitBranch = useSessionGitBranch(session)
  const indicators = buildSessionProvenance({ session, gitBranch, terminalCount: 0 })

  if (indicators.length === 0) return null

  return (
    <>
      {indicators.map((indicator) => (
        <ProvenanceIndicator key={indicator.kind} indicator={indicator} />
      ))}
    </>
  )
}
