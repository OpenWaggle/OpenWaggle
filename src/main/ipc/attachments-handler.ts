import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import type { AttachmentOrigin } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { withArgumentRefusal } from '../application/host-ui-argument-schemas'
import { dispatchGuiSessionCommand } from '../application/gui-session-command'
import { decodeSessionOperationArgument } from '../application/host-ui-session-operation-validation'
import { appPaths } from '../desktop-shell/app-paths'
import { createLogger } from '../logger'
import {
  configurePreparedAttachmentRegistry,
  rememberPreparedAttachment,
} from '../utils/attachment-registry'
import { discardRegisteredImageAttachment } from './attachment-preparation'
import {
  cleanupTempAttachments,
  createTempPromptPath,
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

/*
 * Each positional argument is decoded with its own schema, and a refusal is the one message
 * that names it. The channel map keeps the labelled argument tuples, which a schema cannot carry.
 */
const projectPathArgumentSchema = withArgumentRefusal(
  Schema.String.pipe(Schema.minLength(1)),
  'Project path must be a non-empty string.',
)
const attachmentPathsArgumentSchema = withArgumentRefusal(
  Schema.Array(Schema.String).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
  `Attachment paths must be a list of at most ${String(ATTACHMENT.MAX_COUNT)} file paths.`,
)
/** The longest file name common file systems (ext4, APFS, NTFS in UTF-8) accept. */
const MAX_FILE_NAME_BYTES = 255
/**
 * The file name a prompt attachment is written under, which the Host shows as its name: a single
 * Markdown file name of letters, digits, spaces, and `_ . · -`, so it can neither leave its
 * directory nor carry markup into the `[Attachment: …]` line the model reads.
 */
const promptAttachmentNameArgumentSchema = withArgumentRefusal(
  Schema.String.pipe(
    Schema.pattern(/^[\p{L}\p{N}_·-][\p{L}\p{N}_. ·-]{0,124}\.md$/u),
    Schema.filter((name) => Buffer.byteLength(name, 'utf8') <= MAX_FILE_NAME_BYTES),
  ),
  'Attachment name must be a Markdown file name of letters, digits, spaces and _ . · -.',
)
const attachmentTextArgumentSchema = withArgumentRefusal(
  Schema.String.pipe(Schema.minLength(1)),
  'Attachment text must be a non-empty string.',
)
const operationIdArgumentSchema = withArgumentRefusal(
  Schema.String.pipe(Schema.minLength(1)),
  'Operation ID must be a non-empty string.',
)

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
    const result = yield* dispatchGuiSessionCommand({
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
      const requestedProjectPath = yield* decodeSessionOperationArgument(
        projectPathArgumentSchema,
        rawProjectPath,
      )
      const paths = yield* decodeSessionOperationArgument(attachmentPathsArgumentSchema, rawPaths)

      const projectPath = yield* validateRequiredProjectPath(requestedProjectPath)
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
    (_event, rawText: unknown, rawOperationId: unknown, rawName?: unknown) =>
      Effect.gen(function* () {
        const text = yield* decodeSessionOperationArgument(attachmentTextArgumentSchema, rawText)
        const operationId = yield* decodeSessionOperationArgument(
          operationIdArgumentSchema,
          rawOperationId,
        )
        const name =
          rawName === undefined
            ? undefined
            : yield* decodeSessionOperationArgument(promptAttachmentNameArgumentSchema, rawName)
        const sizeBytes = Buffer.byteLength(text, 'utf8')
        if (sizeBytes > ATTACHMENT.MAX_SIZE_BYTES) {
          return yield* Effect.fail(
            new Error(`Generated attachment exceeds ${String(TEXT_ATTACHMENT_MAX_SIZE_MB)} MB.`),
          )
        }

        // Named after the composer's label, so the sent message shows the chip's name.
        const filePath = yield* Effect.promise(() => createTempPromptPath(name))
        const fileName = path.basename(filePath)

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

export function registerAttachmentHandlers() {
  configurePreparedAttachmentRegistry(appPaths.userData())
  void cleanupTempAttachments().catch((error: unknown) => {
    logger.warn('Temp prompt attachment cleanup failed during startup', describeUnknownError(error))
  })

  registerPrepareAttachmentHandler()
  registerPrepareFromTextAttachmentHandler()
  registerDiscardAttachmentHandler()
}
