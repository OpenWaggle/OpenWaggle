import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { SyntaxThemeImportPreview } from '@shared/types/syntax-resources'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import {
  applySyntaxThemePreview,
  listInstalledSyntaxThemes,
  parseSyntaxThemeSource,
  removeInstalledSyntaxTheme,
} from '../adapters/syntax-theme-import'
import { browserWindowFromWebContents, showOpenDialog } from '../desktop-ui'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1_000
const IMPORT_PREVIEW_LIMIT = 2
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

interface PendingPreview {
  readonly preview: SyntaxThemeImportPreview
  readonly expiresAt: number
  readonly ownerId: number
}

const pendingPreviews = new Map<string, PendingPreview>()

function resourcesDirectory() {
  return path.join(app.getPath('userData'), 'syntax-resources')
}

function sweepExpiredPreviews() {
  const now = Date.now()
  for (const [token, pending] of pendingPreviews) {
    if (pending.expiresAt <= now) pendingPreviews.delete(token)
  }
}

function retainPendingPreview(preview: SyntaxThemeImportPreview, ownerId: number) {
  sweepExpiredPreviews()
  for (const [token, pending] of pendingPreviews) {
    if (pending.ownerId === ownerId) pendingPreviews.delete(token)
  }
  while (pendingPreviews.size >= IMPORT_PREVIEW_LIMIT) {
    const oldestToken = pendingPreviews.keys().next().value
    if (!oldestToken) break
    pendingPreviews.delete(oldestToken)
  }
  pendingPreviews.set(preview.token, {
    preview,
    ownerId,
    expiresAt: Date.now() + IMPORT_PREVIEW_TTL_MS,
  })
}

export function registerSyntaxThemeHandlers() {
  typedHandle('syntax-themes:list', (_event, rawProjectPath) =>
    Effect.gen(function* () {
      const projectPath = rawProjectPath
        ? yield* Effect.gen(function* () {
            const validatedPath = yield* validateRequiredProjectPath(
              decodeUnknownOrThrow(nonEmptyStringSchema, rawProjectPath),
            )
            const authorization = yield* WorkspaceProjectAuthorization
            return yield* authorization.authorize(validatedPath)
          })
        : null
      return yield* Effect.tryPromise(() =>
        listInstalledSyntaxThemes(resourcesDirectory(), projectPath),
      )
    }),
  )

  typedHandle('syntax-themes:select-import', (event) =>
    Effect.tryPromise(async () => {
      const selection = await showOpenDialog(browserWindowFromWebContents(event.sender), {
        title: 'Import syntax theme or language',
        properties: ['openFile', 'openDirectory'],
        filters: [
          {
            name: 'Syntax resources',
            extensions: ['json', 'jsonc', 'tmTheme', 'tmLanguage', 'vsix'],
          },
          { name: 'All files', extensions: ['*'] },
        ],
      })
      const sourcePath = selection.filePaths[0]
      if (selection.canceled || !sourcePath) return null
      const [resources, installed] = await Promise.all([
        parseSyntaxThemeSource(sourcePath, 'user'),
        listInstalledSyntaxThemes(resourcesDirectory()),
      ])
      const importedResources = [
        ...resources.themes,
        ...resources.languages,
        ...resources.appearances,
      ]
      const installedIds = new Set(
        [...installed.themes, ...installed.languages, ...installed.appearances].map(
          (resource) => resource.id,
        ),
      )
      const token = randomUUID()
      const preview: SyntaxThemeImportPreview = {
        token,
        sourcePath,
        themes: resources.themes,
        languages: resources.languages,
        appearances: resources.appearances,
        replacements: importedResources.flatMap((resource) =>
          installedIds.has(resource.id) ? [resource.id] : [],
        ),
        warnings: [
          ...resources.themes.flatMap((theme) =>
            Object.keys(theme.theme.colors).length === 0
              ? [`${theme.label} does not declare editor UI colours; syntax tokens still import.`]
              : [],
          ),
          ...resources.languages.flatMap((language) =>
            language.engine === 'oniguruma'
              ? [`${language.label} requires the isolated Oniguruma compatibility engine.`]
              : [],
          ),
        ],
      }
      retainPendingPreview(preview, event.sender.id)
      return preview
    }),
  )

  typedHandle('syntax-themes:apply-import', (event, rawToken) =>
    Effect.tryPromise(async () => {
      const token = decodeUnknownOrThrow(nonEmptyStringSchema, rawToken)
      sweepExpiredPreviews()
      const pending = pendingPreviews.get(token)
      if (!pending || pending.ownerId !== event.sender.id) {
        throw new Error('Theme import preview expired. Preview the source again.')
      }
      await applySyntaxThemePreview(resourcesDirectory(), pending.preview)
      pendingPreviews.delete(token)
      return listInstalledSyntaxThemes(resourcesDirectory())
    }),
  )

  typedHandle('syntax-themes:remove', (_event, rawThemeId) =>
    Effect.tryPromise(async () => {
      const themeId = decodeUnknownOrThrow(nonEmptyStringSchema, rawThemeId)
      await removeInstalledSyntaxTheme(resourcesDirectory(), themeId)
      return listInstalledSyntaxThemes(resourcesDirectory())
    }),
  )
}
