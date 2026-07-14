import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

export function getProjectExtensionRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS)
}

export function getGlobalExtensionRoot(userDataPath: string) {
  return path.join(userDataPath, OPENWAGGLE_EXTENSION.GLOBAL_EXTENSIONS_DIR)
}
