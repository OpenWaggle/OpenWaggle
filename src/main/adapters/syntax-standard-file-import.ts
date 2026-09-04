import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyntaxResourceScope } from '@shared/types/syntax-resources'
import { normalizedLanguage } from './syntax-language-normalization'
import { nativeSyntaxResources } from './syntax-native-import'
import {
  confinedExtensionPath,
  createThemeIncludeBudget,
  isRecord,
  parseJsonText,
  parseTextMatePlist,
  readBoundedFile,
  resolveThemeDeclaration,
  type SyntaxReadBudget,
} from './syntax-resource-import-utils'
import { normalizedTheme } from './syntax-theme-normalization'

export async function parseJsonSyntaxFile(
  filePath: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
) {
  const includeBudget = createThemeIncludeBudget()
  const entryPath = await fs.realpath(filePath)
  const raw = parseJsonText(
    (await readBoundedFile(entryPath, includeBudget, readBudget)).toString('utf8'),
    includeBudget,
  )
  if (!isRecord(raw)) throw new Error('Theme JSON must contain an object.')
  const native = nativeSyntaxResources(raw, filePath, scope)
  if (native) return native
  if (typeof raw.scopeName === 'string' && Array.isArray(raw.patterns)) {
    return {
      themes: [],
      languages: [
        normalizedLanguage({
          grammar: raw,
          declaration: raw,
          language: undefined,
          packageId: path.basename(filePath).replace(/\.tmLanguage(?:\.json)?$/iu, ''),
          format: 'vscode-json',
          sourcePath: filePath,
          scope,
        }),
      ],
      appearances: [],
    }
  }
  const label =
    typeof raw.name === 'string' ? raw.name : path.basename(filePath, path.extname(filePath))
  const themeRoot = path.dirname(entryPath)
  const parsedByPath = new Map<string, unknown>([[entryPath, raw]])
  const resolved = await resolveThemeDeclaration(
    entryPath,
    async (resourcePath) => {
      const cached = parsedByPath.get(resourcePath)
      if (cached !== undefined) return cached
      const value = parseJsonText(
        (await readBoundedFile(resourcePath, includeBudget, readBudget)).toString('utf8'),
        includeBudget,
      )
      if (!isRecord(value)) throw new Error('VS Code theme declaration must contain an object.')
      parsedByPath.set(resourcePath, value)
      return value
    },
    async (resourcePath, includePath) => {
      const declaredPath = confinedExtensionPath(
        themeRoot,
        path.resolve(path.dirname(resourcePath), includePath),
      )
      return confinedExtensionPath(themeRoot, await fs.realpath(declaredPath))
    },
  )
  return {
    themes: [
      normalizedTheme({
        raw: resolved.raw,
        originalRaw: resolved.original,
        label,
        packageId: label,
        format: 'vscode-json',
        sourcePath: filePath,
        scope,
      }),
    ],
    languages: [],
    appearances: [],
  }
}

export async function parseTextMateSyntaxFile(
  filePath: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
) {
  const raw: unknown = parseTextMatePlist(
    (await readBoundedFile(filePath, undefined, readBudget)).toString('utf8'),
  )
  if (isRecord(raw) && typeof raw.scopeName === 'string' && Array.isArray(raw.patterns)) {
    return {
      themes: [],
      languages: [
        normalizedLanguage({
          grammar: raw,
          declaration: raw,
          language: undefined,
          packageId: path.basename(filePath).replace(/\.tmLanguage$/iu, ''),
          format: 'textmate-plist',
          sourcePath: filePath,
          scope,
        }),
      ],
      appearances: [],
    }
  }
  const label = isRecord(raw) && typeof raw.name === 'string' ? raw.name : path.basename(filePath)
  return {
    themes: [
      normalizedTheme({
        raw,
        label,
        packageId: label,
        format: 'textmate-plist',
        sourcePath: filePath,
        scope,
      }),
    ],
    languages: [],
    appearances: [],
  }
}
