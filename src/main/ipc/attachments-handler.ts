import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { createLogger } from '../logger'
import {
  configurePreparedAttachmentRegistry,
  rememberPreparedAttachment,
} from '../utils/attachment-registry'
import {
  contentSha256,
  discardRegisteredImageAttachment,
  prepareRegisteredAttachment,
} from './attachment-preparation'
import {
  buildTempPromptFilename,
  cleanupTempAttachments,
  ensureTempAttachmentsDirectory,
  TEMP_PROMPT_MIME_TYPE,
  TEXT_ATTACHMENT_MAX_SIZE_MB,
  writePromptTextFileWithProgress,
} from './attachment-temp-files'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export {
  discardRegisteredImageAttachment,
  prepareRegisteredAttachment,
  prepareRegisteredImageAttachmentFromBytes,
} from './attachment-preparation'

const logger = createLogger('ipc/attachments')

const prepareArgsSchema = Schema.Struct({
  projectPath: Schema.String.pipe(Schema.minLength(1)),
  paths: Schema.Array(Schema.String).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
})
const prepareFromTextArgsSchema = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.String.pipe(Schema.minLength(1)),
})

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: String(error) }
}

export { hydrateAttachmentSources } from '../utils/attachment-hydration'

function registerPrepareAttachmentHandler() {
  typedHandle('attachments:prepare', (_event, rawProjectPath: unknown, rawPaths: unknown) =>
    Effect.gen(function* () {
      const { projectPath: pp, paths } = decodeUnknownOrThrow(prepareArgsSchema, {
        projectPath: rawProjectPath,
        paths: rawPaths,
      })

      const projectPath = yield* validateRequiredProjectPath(pp)

      const normalized = paths.map((entry) =>
        path.normalize(path.isAbsolute(entry) ? entry : path.resolve(projectPath, entry)),
      )

      const uniquePaths = [...new Set(normalized)]
      if (uniquePaths.length === 0) return []
      if (uniquePaths.length > ATTACHMENT.MAX_COUNT) {
        return yield* Effect.fail(
          new Error(
            `A maximum of ${String(ATTACHMENT.MAX_COUNT)} attachments is supported per message.`,
          ),
        )
      }

      const resolvedPaths = yield* Effect.promise(() =>
        Promise.all(uniquePaths.map((filePath) => fs.realpath(filePath))),
      )
      const stats = yield* Effect.promise(() =>
        Promise.all(resolvedPaths.map((filePath) => fs.stat(filePath))),
      )
      const totalSize = stats.reduce((sum, stat) => sum + stat.size, 0)
      if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
        return yield* Effect.fail(
          new Error(
            `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
          ),
        )
      }

      const prepared: PreparedAttachment[] = []
      for (const filePath of resolvedPaths) {
        const attachment = yield* Effect.promise(() => prepareRegisteredAttachment(filePath))
        prepared.push(attachment)
      }
      return prepared
    }),
  )
}

function registerPrepareFromTextAttachmentHandler() {
  typedHandle(
    'attachments:prepare-from-text',
    (_event, rawText: unknown, rawOperationId: unknown) =>
      Effect.gen(function* () {
        const { text, operationId } = decodeUnknownOrThrow(prepareFromTextArgsSchema, {
          text: rawText,
          operationId: rawOperationId,
        })
        const sizeBytes = Buffer.byteLength(text, 'utf8')
        if (sizeBytes > ATTACHMENT.MAX_SIZE_BYTES) {
          return yield* Effect.fail(
            new Error(`Generated attachment exceeds ${String(TEXT_ATTACHMENT_MAX_SIZE_MB)} MB.`),
          )
        }

        const tempAttachmentsDir = yield* Effect.promise(() => ensureTempAttachmentsDirectory())
        const fileName = buildTempPromptFilename(Date.now())
        const filePath = path.join(tempAttachmentsDir, fileName)

        yield* Effect.promise(() => writePromptTextFileWithProgress(filePath, text, operationId))
        const stats = yield* Effect.promise(() => fs.stat(filePath))
        if (!stats.isFile()) {
          return yield* Effect.fail(
            new Error(`Temporary prompt attachment is not a file: ${fileName}`),
          )
        }

        const attachment: PreparedAttachment = {
          id: randomUUID(),
          kind: 'text',
          origin: 'auto-paste-text',
          name: fileName,
          path: filePath,
          mimeType: TEMP_PROMPT_MIME_TYPE,
          sizeBytes: stats.size,
          contentSha256: contentSha256(Buffer.from(text, 'utf8')),
          extractedText: text,
        }
        yield* Effect.promise(() => rememberPreparedAttachment(attachment, filePath))
        return attachment
      }),
  )
}

function registerDiscardAttachmentHandler() {
  typedHandle('attachments:discard', (_event, rawAttachment: unknown) =>
    Effect.gen(function* () {
      const attachment = decodeUnknownOrThrow(preparedAttachmentSchema, rawAttachment)
      yield* Effect.promise(() => discardRegisteredImageAttachment(attachment))
    }),
  )
}

export function registerAttachmentHandlers(): void {
  configurePreparedAttachmentRegistry(app.getPath('userData'))
  void cleanupTempAttachments().catch((error: unknown) => {
    logger.warn('Temp prompt attachment cleanup failed during startup', describeUnknownError(error))
  })

  registerPrepareAttachmentHandler()
  registerPrepareFromTextAttachmentHandler()
  registerDiscardAttachmentHandler()
}
