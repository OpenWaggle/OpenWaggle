import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { ipcMain } from 'electron'
import { z } from 'zod'

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_TEXT_CHARS = 12_000

const prepareArgsSchema = z.object({
  projectPath: z.string().min(1),
  paths: z.array(z.string()).max(MAX_ATTACHMENTS),
})

function resolveAttachmentKind(mimeType: string): PreparedAttachment['kind'] {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'text'
}

function guessMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.md':
      return 'text/markdown'
    case '.json':
      return 'application/json'
    case '.yaml':
    case '.yml':
      return 'application/yaml'
    case '.xml':
      return 'application/xml'
    case '.csv':
      return 'text/csv'
    case '.log':
      return 'text/plain'
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
    case '.py':
    case '.java':
    case '.go':
    case '.rs':
    case '.swift':
    case '.kt':
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
    case '.html':
    case '.htm':
    case '.txt':
      return 'text/plain'
    default:
      return null
  }
}

function normalizeText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n...[truncated]`
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default
    const parsed = await pdfParse(buffer)
    return normalizeText(parsed.text ?? '')
  } catch {
    return ''
  }
}

async function extractTextFromImage(buffer: Buffer): Promise<string> {
  try {
    const tesseract = await import('tesseract.js')
    const result = await tesseract.recognize(buffer, 'eng')
    return normalizeText(result.data.text ?? '')
  } catch {
    return ''
  }
}

async function prepareAttachment(filePath: string): Promise<PreparedAttachment> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB: ${path.basename(filePath)}`,
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

  let extractedText = ''
  if (kind === 'pdf') {
    extractedText = await extractTextFromPdf(buffer)
  } else if (kind === 'image') {
    extractedText = await extractTextFromImage(buffer)
  } else {
    extractedText = normalizeText(buffer.toString('utf8'))
  }

  const source =
    kind === 'image' || kind === 'pdf'
      ? {
          type: 'data' as const,
          value: buffer.toString('base64'),
          mimeType,
        }
      : null

  return {
    id: randomUUID(),
    kind,
    name: path.basename(filePath),
    path: filePath,
    mimeType,
    sizeBytes: stats.size,
    extractedText,
    source,
  }
}

export function registerAttachmentHandlers(): void {
  ipcMain.handle(
    'attachments:prepare',
    async (_event, rawProjectPath: unknown, rawPaths: unknown) => {
      const { projectPath, paths } = prepareArgsSchema.parse({
        projectPath: rawProjectPath,
        paths: rawPaths,
      })

      if (!path.isAbsolute(projectPath)) {
        throw new Error('Project path must be absolute.')
      }

      const normalized = paths
        .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(projectPath, entry)))
        .map((entry) => path.normalize(entry))

      const uniquePaths = [...new Set(normalized)]
      if (uniquePaths.length === 0) return []
      if (uniquePaths.length > MAX_ATTACHMENTS) {
        throw new Error(
          `A maximum of ${String(MAX_ATTACHMENTS)} attachments is supported per message.`,
        )
      }

      const stats = await Promise.all(uniquePaths.map((filePath) => fs.stat(filePath)))
      const totalSize = stats.reduce((sum, stat) => sum + stat.size, 0)
      if (totalSize > MAX_TOTAL_SIZE_BYTES) {
        throw new Error(
          `Total attachment size exceeds ${String(MAX_TOTAL_SIZE_BYTES / (1024 * 1024))} MB.`,
        )
      }

      const prepared: PreparedAttachment[] = []
      for (const filePath of uniquePaths) {
        prepared.push(await prepareAttachment(filePath))
      }
      return prepared
    },
  )
}
