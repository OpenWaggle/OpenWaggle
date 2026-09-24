import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActionManifest } from '@shared/types/action-definitions'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import type { ActionPublicationIdentity } from '../../domain/project-action-catalog'
import {
  actionContentRevision,
  readActionConfigSource,
  readActionWorkspaceIdentity,
  serializeActionManifest,
} from './action-manifest-file'

const RECOVERY_DIRECTORY = '.openwaggle/action-recovery'
const RECOVERY_README = `# Project Actions recovery files

Each publication keeps its displaced actions.json inode as previous.json. An editor that already
has that file open can still write to it after publication, so OpenWaggle never deletes these
backups automatically. next.json is the prepared publication and proves an interrupted install
through its file identity. Conflicts retain both drafts in Project Actions settings, with the
recovery directory shown in pending-save details.

After closing external editors and reviewing any pending save, compare previous.json, next.json
and ../actions.json before manually removing old publication directories. These files stay on the
workspace filesystem so capture and exclusive installation cannot cross devices. This directory
ignores its own contents in Git; it is local recovery data, not shared configuration.
`

export const actionPublicationRelativePath = (id: string) => join(RECOVERY_DIRECTORY, id)

export const actionPublicationPath = (workspace: string, id: string) =>
  join(workspace, actionPublicationRelativePath(id))

export async function actionPublicationCurrent(
  workspace: string,
  publication: ActionPublicationIdentity,
) {
  const current = await readActionWorkspaceIdentity(
    actionPublicationPath(workspace, publication.id),
  )
  return (
    current !== null &&
    current.device === publication.device &&
    current.inode === publication.inode &&
    current.birthtime === publication.birthtime
  )
}

async function writeExclusive(path: string, content: string) {
  const handle = await open(path, 'wx').catch((error: unknown) => {
    if (isNodeError(error, 'EEXIST')) return null
    throw error
  })
  if (!handle) return false
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return true
}

export async function createActionPublication(
  workspace: string,
  requireWorkspace: () => Promise<void>,
): Promise<ActionPublicationIdentity> {
  for (const directory of ['.openwaggle', RECOVERY_DIRECTORY]) {
    await requireWorkspace()
    const path = join(workspace, directory)
    // Do not recreate a missing Workspace or follow a symlinked recovery directory.
    await mkdir(path).catch((error: unknown) => {
      if (!isNodeError(error, 'EEXIST')) throw error
    })
    if (!(await readActionWorkspaceIdentity(path)))
      throw new Error('Project Actions recovery must use a regular Workspace directory.')
  }
  const recovery = join(workspace, RECOVERY_DIRECTORY)
  const identity = await readActionWorkspaceIdentity(recovery)
  if (!identity) throw new Error('The Project Actions recovery directory changed.')
  const requireRecovery = async () => {
    await requireWorkspace()
    const current = await readActionWorkspaceIdentity(recovery)
    if (JSON.stringify(current) !== JSON.stringify(identity))
      throw new Error('The Project Actions recovery directory changed.')
  }
  await requireRecovery()
  await writeExclusive(join(recovery, '.gitignore'), '*\n')
  if ((await readActionConfigSource(workspace, `${RECOVERY_DIRECTORY}/.gitignore`)) !== '*\n')
    throw new Error(
      'The Project Actions recovery .gitignore was edited. It has been left unchanged.',
    )
  await requireRecovery()
  await writeExclusive(join(recovery, 'README.md'), RECOVERY_README)
  const id = randomUUID()
  const path = actionPublicationPath(workspace, id)
  await requireRecovery()
  await mkdir(path)
  const publicationIdentity = await readActionWorkspaceIdentity(path)
  if (!publicationIdentity) throw new Error('The Project Actions recovery directory changed.')
  return { id, ...publicationIdentity }
}

/** False retains the journal and both drafts; no competing target is ever replaced or removed. */
export async function writeActionManifest(
  workspace: string,
  expectedRevision: string,
  manifest: ActionManifest,
  publication: ActionPublicationIdentity,
  requireWorkspace: () => Promise<void>,
): Promise<boolean> {
  const directory = actionPublicationPath(workspace, publication.id)
  const requirePublication = async () => {
    await requireWorkspace()
    if (!(await actionPublicationCurrent(workspace, publication)))
      throw new Error('The Project Actions recovery directory changed. Your drafts have been kept.')
  }
  const target = join(workspace, '.openwaggle/actions.json')
  const previous = join(directory, 'previous.json')
  const next = join(directory, 'next.json')
  const targetSource = '.openwaggle/actions.json'
  const previousSource = `${RECOVERY_DIRECTORY}/${publication.id}/previous.json`
  const nextSource = `${RECOVERY_DIRECTORY}/${publication.id}/next.json`
  const read = (source: string) => readActionConfigSource(workspace, source)
  const content = serializeActionManifest(manifest)
  const installed = async () => {
    const targetFile = await lstat(target).catch((error: unknown) => {
      if (isEnoent(error)) return null
      throw error
    })
    const prepared = await lstat(next)
    return (
      targetFile?.isFile() &&
      targetFile.dev === prepared.dev &&
      targetFile.ino === prepared.ino &&
      (await read(targetSource)) === content
    )
  }
  await requirePublication()
  if ((await read(nextSource)) === null) {
    const staging = join(directory, `${randomUUID()}.staging`)
    if (!(await writeExclusive(staging, content)))
      throw new Error('The Project Actions publication staging file already exists.')
    try {
      await requirePublication()
      // This also proves hard links work before moving the current manifest aside.
      await link(staging, next).catch((error: unknown) => {
        if (!isNodeError(error, 'EEXIST')) throw error
      })
    } finally {
      await unlink(staging)
    }
  }
  if ((await read(nextSource)) !== content) return false
  if (await installed())
    return actionContentRevision(await read(previousSource)) === expectedRevision

  // Moving the target captures the latest inode atomically, including an editor's atomic save.
  if ((await read(previousSource)) === null) {
    if (actionContentRevision(await read(targetSource)) !== expectedRevision) return false
    await requirePublication()
    await rename(target, previous).catch((error: unknown) => {
      if (!isEnoent(error)) throw error
    })
  }
  if (actionContentRevision(await read(previousSource)) !== expectedRevision) {
    await requirePublication()
    // Restore a captured external edit only into an empty pathname. Keep the backup either way.
    await link(previous, target).catch((error: unknown) => {
      if (!isNodeError(error, 'EEXIST') && !isEnoent(error)) throw error
    })
    return false
  }
  await requirePublication()
  await link(next, target).catch((error: unknown) => {
    if (!isNodeError(error, 'EEXIST')) throw error
  })
  await requirePublication()
  // Equal bytes on another inode are an external save, never proof that our install completed.
  return (
    (await installed()) === true &&
    actionContentRevision(await read(previousSource)) === expectedRevision
  )
}
