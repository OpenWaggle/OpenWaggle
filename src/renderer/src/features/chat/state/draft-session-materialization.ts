interface DraftMaterialization {
  readonly projectPath: string
  readonly sessionId: string
}

let navigationGeneration = 0
let pendingMaterialization: DraftMaterialization | null = null

/** Capture before asynchronous creation; navigation revokes that draft's authority. */
export function draftMaterializationGeneration() {
  return navigationGeneration
}

export function invalidateDraftMaterialization() {
  navigationGeneration += 1
  pendingMaterialization = null
}

/** One pending receipt, issued only by successful creation of the current draft. */
export function recordDraftMaterialization(
  projectPath: string,
  sessionId: string,
  generation: number,
) {
  if (generation !== navigationGeneration) return
  pendingMaterialization = { projectPath, sessionId }
}

/** An uncertain/failed migration is never replayed by a later navigation. */
export function takeDraftMaterialization(projectPath: string | null, sessionId: string) {
  if (
    pendingMaterialization?.projectPath !== projectPath ||
    pendingMaterialization?.sessionId !== sessionId
  )
    return false
  pendingMaterialization = null
  return true
}
