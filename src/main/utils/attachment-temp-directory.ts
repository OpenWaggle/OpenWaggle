import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { appPaths } from '../desktop-shell/app-paths'

/**
 * The directory the app writes copies of attachments it produced itself into: a pasted image, a
 * converted HEIC, a prompt written from long text. It lives in `utils/` because both attachment
 * preparation paths need it — the window's own (`ipc/attachment-preparation.ts`) and the Session
 * Host's (`utils/attachment-preparation.ts`) — and `utils/` may not import `ipc/`.
 */
const TEMP_ATTACHMENTS_DIRECTORY_NAME = 'temp-attachments'

export async function ensureTempAttachmentsDirectory() {
  const tempAttachmentsDir = path.join(appPaths.userData(), TEMP_ATTACHMENTS_DIRECTORY_NAME)
  await fs.mkdir(tempAttachmentsDir, { recursive: true })
  return tempAttachmentsDir
}

/** Private to the app, like the copies the window writes for the images it produced itself. */
const PRIVATE_ATTACHMENT_FILE_MODE = 0o600

/**
 * Writes a copy of an attachment the app produced itself, such as a decoded HEIC, and answers the
 * path the attachment then owns: hydration re-reads that path and checks it against `sizeBytes`.
 * The prefix names which path wrote the copy, so a support log can tell a Session resource from a
 * window-prepared image without opening it.
 */
export async function writeTempAttachment(
  bytes: Uint8Array,
  extension: string,
  prefix: 'attachment' | 'resource',
) {
  const directory = await ensureTempAttachmentsDirectory()
  const filePath = path.join(directory, `${prefix}-${randomUUID()}${extension}`)
  await fs.writeFile(filePath, bytes, { flag: 'wx', mode: PRIVATE_ATTACHMENT_FILE_MODE })
  return filePath
}
