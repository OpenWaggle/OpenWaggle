/**
 * Projects whose removal is in progress (ADR 0048). Removing a project deletes its Sessions one
 * by one before the project leaves the settings; discovery must neither list the discovered ones
 * again in between nor add Sessions to the project while the removal checks what it deletes.
 * The desktop app starts the pause before it reads the Sessions it will delete, and a pass checks
 * it before each Session it creates and again when it attaches the file. A pause ends when a pass
 * finds the project gone, or after a while if the removal stopped short.
 */

const PROJECT_REMOVAL_PAUSE_MS = 2 * 60_000
const pausedUntil = new Map<string, number>()

export function pausePiSessionDiscovery(projectPath: string, now = Date.now()) {
  pausedUntil.set(projectPath, now + PROJECT_REMOVAL_PAUSE_MS)
}

/** Whether a removal of the project is in progress, checked before each Session is listed. */
export function isPiSessionDiscoveryPaused(projectPath: string, now = Date.now()) {
  const until = pausedUntil.get(projectPath)
  return until !== undefined && until > now
}

/** The projects a pass may scan; pauses for projects no longer listed are over. */
export function unpausedProjects(projectPaths: readonly string[], now = Date.now()) {
  const listed = new Set(projectPaths)
  for (const [projectPath, until] of pausedUntil) {
    if (!listed.has(projectPath) || until <= now) pausedUntil.delete(projectPath)
  }
  return projectPaths.filter((projectPath) => !pausedUntil.has(projectPath))
}
