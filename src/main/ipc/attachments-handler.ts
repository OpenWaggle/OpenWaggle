import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { AttachmentOrigin } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { createLogger } from '../logger'
import {
  configurePreparedAttachmentRegistry,
  rememberPreparedAttachment,
} from '../utils/attachment-registry'
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

function prepareAttachmentsThroughHost(
  baseDirectory: string,
  entries: readonly { readonly path: string; readonly origin?: AttachmentOrigin }[],
) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: baseDirectory },
      payload: {
        contract: 'local-attachments-v1',
        request: { requestId: randomUUID(), entries },
      },
    })
    if (result.contract !== 'local-attachments-v1') {
      return yield* Effect.fail(new Error('Session Host rejected attachment preparation.'))
    }
    for (const attachment of result.response.attachments) {
      yield* Effect.promise(() => rememberPreparedAttachment(attachment, attachment.path))
    }
    return [...result.response.attachments]
  })
}

function registerPrepareAttachmentHandler() {
  typedHandle('attachments:prepare', (_event, rawProjectPath: unknown, rawPaths: unknown) =>
    Effect.gen(function* () {
      const { projectPath: pp, paths } = decodeUnknownOrThrow(prepareArgsSchema, {
        projectPath: rawProjectPath,
        paths: rawPaths,
      })

      const projectPath = yield* validateRequiredProjectPath(pp)
      return yield* prepareAttachmentsThroughHost(
        projectPath,
        paths.map((filePath) => ({ path: filePath })),
      )
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

        const attachments = yield* prepareAttachmentsThroughHost(process.cwd(), [
          { path: filePath, origin: 'auto-paste-text' },
        ])
        const attachment = attachments[0]
        if (!attachment) {
          return yield* Effect.fail(new Error('Generated attachment preparation returned no file.'))
        }
        return { ...attachment, mimeType: TEMP_PROMPT_MIME_TYPE, extractedText: text }
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
}
