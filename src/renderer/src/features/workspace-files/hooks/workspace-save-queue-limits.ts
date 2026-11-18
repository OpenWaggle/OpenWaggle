import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import type { WorkspaceDocumentEditBatch } from '@shared/types/workspace-files'

export function isWithinWorkspaceEditTransportLimits(
  batches: readonly WorkspaceDocumentEditBatch[],
) {
  let changeCount = 0
  let insertedCodeUnits = 0
  for (const batch of batches) {
    if (batch.changes.length > WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT) return false
    changeCount += batch.changes.length
    if (changeCount > WORKSPACE_FILES.DOCUMENT_EDIT_CHANGE_LIMIT) return false
    for (const change of batch.changes) {
      insertedCodeUnits += change.text.length
      if (insertedCodeUnits > WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT) return false
    }
  }
  return batches.length <= WORKSPACE_FILES.DOCUMENT_EDIT_BATCH_LIMIT
}
