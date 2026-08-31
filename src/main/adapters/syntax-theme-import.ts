import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyntaxResourceCatalog, SyntaxResourceScope } from '@shared/types/syntax-resources'
import {
  applySyntaxThemePreview,
  listInstalledSyntaxResources,
  removeInstalledSyntaxTheme,
} from './syntax-resource-persistence'
import { parseJsonSyntaxFile, parseTextMateSyntaxFile } from './syntax-standard-file-import'
import {
  parseUnpackedSyntaxExtension,
  parseVsixSyntaxExtension,
} from './syntax-vscode-extension-import'

export { applySyntaxThemePreview, removeInstalledSyntaxTheme }

export async function parseSyntaxThemeSource(
  filePath: string,
  scope: SyntaxResourceScope,
): Promise<SyntaxResourceCatalog> {
  const stats = await fs.stat(filePath)
  if (stats.isDirectory()) return parseUnpackedSyntaxExtension(filePath, scope)
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.vsix') return parseVsixSyntaxExtension(filePath, scope)
  if (extension === '.tmtheme' || extension === '.tmlanguage') {
    return parseTextMateSyntaxFile(filePath, scope)
  }
  if (extension === '.json' || extension === '.jsonc') {
    return parseJsonSyntaxFile(filePath, scope)
  }
  throw new Error(
    'Choose a VS Code JSON/JSONC, TextMate plist, VSIX/unpacked extension, or OpenWaggle package.',
  )
}

export function listInstalledSyntaxThemes(resourcesDirectory: string, projectPath?: string | null) {
  return listInstalledSyntaxResources(resourcesDirectory, projectPath, parseSyntaxThemeSource)
}
