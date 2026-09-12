import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { assertOperationPathScope } from './filesystem-session-export-artifact-support'

const OWNER_DIRECTORY_MODE = 0o700
const SCOPED_EXPORT_STAGING_DIRECTORY = `openwaggle-session-exports-${String(
  process.getuid?.() ?? 'local',
)}`

export function scopedExportWorkingRoot(operation: SessionExportOperationRecord) {
  const identity = createHash('sha256').update(operation.exportOperationId).digest('hex')
  return path.join(os.tmpdir(), SCOPED_EXPORT_STAGING_DIRECTORY, identity)
}

export async function prepareExportWorkingPaths(operation: SessionExportOperationRecord) {
  if (operation.destinationRoot) {
    throw new Error('Scoped exports must use unlinked descriptor-backed staging.')
  }
  await assertOperationPathScope(operation, operation.temporaryPath)
  await mkdir(path.dirname(operation.destinationPath), { recursive: true })
  await assertOperationPathScope(operation, operation.destinationPath)
  await assertOperationPathScope(operation, operation.temporaryPath)
  await rm(operation.temporaryPath, { force: true })
  const stagingPath = operation.format === 'bundle' ? `${operation.temporaryPath}.staging` : null
  if (stagingPath) {
    await rm(stagingPath, { recursive: true, force: true })
    await mkdir(stagingPath, { recursive: true, mode: OWNER_DIRECTORY_MODE })
  }
  return { workingRoot: null, artifactPath: operation.temporaryPath, stagingPath }
}

export async function discardOperationArtifacts(operation: SessionExportOperationRecord) {
  if (operation.destinationRoot) {
    await assertOperationPathScope(operation, operation.destinationPath)
    await rm(scopedExportWorkingRoot(operation), { recursive: true, force: true })
    return
  }
  await assertOperationPathScope(operation, operation.temporaryPath)
  await rm(operation.temporaryPath, { force: true })
  await assertOperationPathScope(operation, `${operation.temporaryPath}.staging`)
  await rm(`${operation.temporaryPath}.staging`, { recursive: true, force: true })
}
