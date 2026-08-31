import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'

const OWNER_DIRECTORY_MODE = 0o700

export async function ensureTrustedAgentDefinitionRoot(root: string, platform = process.platform) {
  await ensureDirectoryPathPinned({ targetDirectory: root, mode: OWNER_DIRECTORY_MODE, platform })
}
