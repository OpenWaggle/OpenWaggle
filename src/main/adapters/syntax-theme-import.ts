import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyntaxResourceCatalog, SyntaxResourceScope } from '@shared/types/syntax-resources'
import type { SyntaxReadBudget } from './syntax-resource-import-utils'
import {
  applySyntaxThemePreview,
  listInstalledSyntaxResources,
  removeInstalledSyntaxTheme,
} from './syntax-resource-persistence'
import { classifySyntaxSourceValidation, SyntaxSourceValidationError } from './syntax-source-errors'
import { parseJsonSyntaxFile, parseTextMateSyntaxFile } from './syntax-standard-file-import'
import {
  parseUnpackedSyntaxExtension,
  parseVsixSyntaxExtension,
} from './syntax-vscode-extension-import'

export { applySyntaxThemePreview, removeInstalledSyntaxTheme }

export async function parseSyntaxThemeSource(
  filePath: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
): Promise<SyntaxResourceCatalog> {
  const stats = await fs.stat(filePath)
  if (stats.isDirectory()) {
    return classifySyntaxSourceValidation(() =>
      parseUnpackedSyntaxExtension(filePath, scope, readBudget),
    )
  }
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.vsix') {
    return classifySyntaxSourceValidation(() =>
      parseVsixSyntaxExtension(filePath, scope, readBudget),
    )
  }
  if (extension === '.tmtheme' || extension === '.tmlanguage') {
    return classifySyntaxSourceValidation(() =>
      parseTextMateSyntaxFile(filePath, scope, readBudget),
    )
  }
  if (extension === '.json' || extension === '.jsonc') {
    return classifySyntaxSourceValidation(() => parseJsonSyntaxFile(filePath, scope, readBudget))
  }
  throw new SyntaxSourceValidationError(
    'Choose a VS Code JSON/JSONC, TextMate plist, VSIX/unpacked extension, or OpenWaggle package.',
  )
}

export function listInstalledSyntaxThemes(resourcesDirectory: string, projectPath?: string | null) {
  return listInstalledSyntaxResources(resourcesDirectory, projectPath, parseSyntaxThemeSource)
}
