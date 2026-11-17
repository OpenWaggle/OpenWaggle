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

/** Only the app reads a directory a named copy lives in. */
const PRIVATE_ATTACHMENT_DIRECTORY_MODE = 0o700
const NAMED_TEMP_ATTACHMENT_DIRECTORY_PATTERN =
  /^(?:attachment|resource)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Whether a temp-attachments entry is a directory `writeNamedTempAttachment` made. */
export function isNamedTempAttachmentDirectory(name: string) {
  return NAMED_TEMP_ATTACHMENT_DIRECTORY_PATTERN.test(name)
}

/**
 * Writes a copy the Session Host prepares, in a directory of its own so the file carries the name
 * the person sees: the Host names an attachment after its file (as `createTempPromptPath` does for
 * a named prompt). The directory is `<prefix>-<uuid>`, which the temp cleanup knows.
 */
export async function writeNamedTempAttachment(
  bytes: Uint8Array,
  fileName: string,
  prefix: 'attachment' | 'resource',
) {
  const directory = path.join(await ensureTempAttachmentsDirectory(), `${prefix}-${randomUUID()}`)
  await fs.mkdir(directory, { mode: PRIVATE_ATTACHMENT_DIRECTORY_MODE })
  const filePath = path.join(directory, fileName)
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx', mode: PRIVATE_ATTACHMENT_FILE_MODE })
  } catch (cause) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
    throw cause
  }
  return filePath
}
