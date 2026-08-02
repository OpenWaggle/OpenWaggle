/**
 * Pure display helper for Session worktree paths, shared between the main
 * process worktree service and the renderer worktree surface (ADR 0010).
 */
export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim()
  if (!trimmed) return worktreePath
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const lastPart = parts[parts.length - 1]?.trim() ?? ''
  return lastPart.length > 0 ? lastPart : trimmed
}
