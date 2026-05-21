import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { rememberPreparedAttachment } from '../utils/attachment-registry'
import {
  buildTempPromptFilename,
  cleanupTempAttachments,
  ensureTempAttachmentsDirectory,
  TEMP_PROMPT_MIME_TYPE,
  TEXT_ATTACHMENT_MAX_SIZE_MB,
  writePromptTextFileWithProgress,
} from './attachment-temp-files'
import {
  DOCX_MIME_TYPE,
  extractAttachmentText,
  ODT_MIME_TYPE,
  RTF_MIME_TYPE,
} from './attachment-text-extraction'
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

function resolveAttachmentKind(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'text'
}

function guessMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  return match(ext)
    .with('.pdf', () => 'application/pdf')
    .with('.png', () => 'image/png')
    .with('.jpg', () => 'image/jpeg')
    .with('.jpeg', () => 'image/jpeg')
    .with('.webp', () => 'image/webp')
    .with('.gif', () => 'image/gif')
    .with('.bmp', () => 'image/bmp')
    .with('.svg', () => 'image/svg+xml')
    .with('.md', () => 'text/markdown')
    .with('.json', () => 'application/json')
    .with('.yaml', () => 'application/yaml')
    .with('.yml', () => 'application/yaml')
    .with('.xml', () => 'application/xml')
    .with('.csv', () => 'text/csv')
    .with('.log', () => 'text/plain')
    .with('.docx', () => DOCX_MIME_TYPE)
    .with('.rtf', () => RTF_MIME_TYPE)
    .with('.odt', () => ODT_MIME_TYPE)
    .with('.ts', () => 'text/plain')
    .with('.tsx', () => 'text/plain')
    .with('.js', () => 'text/plain')
    .with('.jsx', () => 'text/plain')
    .with('.mjs', () => 'text/plain')
    .with('.cjs', () => 'text/plain')
    .with('.py', () => 'text/plain')
    .with('.java', () => 'text/plain')
    .with('.go', () => 'text/plain')
    .with('.rs', () => 'text/plain')
    .with('.swift', () => 'text/plain')
    .with('.kt', () => 'text/plain')
    .with('.css', () => 'text/plain')
    .with('.scss', () => 'text/plain')
    .with('.sass', () => 'text/plain')
    .with('.less', () => 'text/plain')
    .with('.html', () => 'text/plain')
    .with('.htm', () => 'text/plain')
    .with('.txt', () => 'text/plain')
    .otherwise(() => null)
}

async function prepareAttachment(filePath: string): Promise<PreparedAttachment> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }
  if (stats.size > ATTACHMENT.MAX_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
    )
  }

  const mimeType = guessMimeType(filePath)
  if (!mimeType) {
    throw new Error(
      `Unsupported attachment type: ${path.basename(filePath)}. Supported: text files, images, PDFs.`,
    )
  }
  const buffer = await fs.readFile(filePath)
  const kind = resolveAttachmentKind(mimeType)
  const attachmentName = path.basename(filePath)

  const extractedText = await extractAttachmentText({ kind, mimeType, buffer, attachmentName })

  return {
    id: randomUUID(),
    kind,
    origin: 'user-file',
    name: path.basename(filePath),
    path: filePath,
    mimeType,
    sizeBytes: stats.size,
    extractedText,
  }
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

      const normalized = paths
        .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(projectPath, entry)))
        .map((entry) => path.normalize(entry))

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
        const attachment = yield* Effect.promise(() => prepareAttachment(filePath))
        rememberPreparedAttachment(attachment, filePath)
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
          extractedText: text,
        }
        rememberPreparedAttachment(attachment, filePath)
        return attachment
      }),
  )
}

export function registerAttachmentHandlers(): void {
  void cleanupTempAttachments().catch((error: unknown) => {
    logger.warn('Temp prompt attachment cleanup failed during startup', describeUnknownError(error))
  })

  registerPrepareAttachmentHandler()
  registerPrepareFromTextAttachmentHandler()
}
