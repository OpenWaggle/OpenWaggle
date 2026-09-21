import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { isUpdateChannel, type UpdateChannel } from '@shared/types/update-channel'

export const INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME = 'install-update-channel'

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function applyInstallerUpdateChannelIntent(
  userDataRoot: string,
  persist: (channel: UpdateChannel) => Promise<void>,
): Promise<UpdateChannel | null> {
  const intentPath = path.join(userDataRoot, INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME)
  let raw: string
  try {
    raw = (await readFile(intentPath, 'utf8')).trim()
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }

  if (!isUpdateChannel(raw)) {
    await rm(intentPath, { force: true })
    return null
  }

  await persist(raw)
  try {
    if ((await readFile(intentPath, 'utf8')).trim() === raw) {
      await rm(intentPath, { force: true })
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  return raw
}
