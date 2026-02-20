import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { dialog } from 'electron'
import { z } from 'zod'
import { safeHandle } from './typed-ipc'

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_TEXT_CHARS = 12_000
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const RTF_MIME_TYPE = 'application/rtf'
const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'

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
    case '.docx':
      return DOCX_MIME_TYPE
    case '.rtf':
      return RTF_MIME_TYPE
    case '.odt':
      return ODT_MIME_TYPE
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

function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function requestExternalAttachmentAccess(
  projectRootPath: string,
  attachmentPath: string,
): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Allow once', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Attachment outside project',
    message: 'This file is outside the active project folder.',
    detail: [
      `Project: ${projectRootPath}`,
      `Attachment: ${attachmentPath}`,
      '',
      'Allow this file once?',
    ].join('\n'),
  })
  return result.response === 0
}

function decodeXmlEntities(value: string): string {
  return value.replaceAll(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_raw, entity: string): string => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }

    switch (entity) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        return ''
    }
  })
}

function extractTextFromRtf(raw: string): string {
  const withParagraphs = raw.replaceAll(/\\par[d]?/g, '\n')
  const withoutHexEscapes = withParagraphs.replaceAll(/\\'[0-9a-fA-F]{2}/g, '')
  const withoutControls = withoutHexEscapes.replaceAll(/\\[a-z]+-?\d* ?/g, '')
  const withoutGroups = withoutControls.replaceAll(/[{}]/g, '')
  const withoutIndentedBreaks = withoutGroups.replaceAll(/\n\s+/g, '\n')
  return normalizeText(withoutIndentedBreaks.replaceAll(/\n{3,}/g, '\n\n'))
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return normalizeText(result.value ?? '')
  } catch {
    return ''
  }
}

async function extractTextFromOdt(buffer: Buffer): Promise<string> {
  try {
    const JSZip = (await import('jszip')).default
    const archive = await JSZip.loadAsync(buffer)
    const content = await archive.file('content.xml')?.async('string')
    if (!content) return ''
    const withoutTags = content.replaceAll(/<[^>]+>/g, ' ')
    const decoded = decodeXmlEntities(withoutTags)
    const normalizedWhitespace = decoded.replaceAll(/\s+/g, ' ')
    return normalizeText(normalizedWhitespace)
  } catch {
    return ''
  }
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
  } else if (mimeType === DOCX_MIME_TYPE) {
    extractedText = await extractTextFromDocx(buffer)
  } else if (mimeType === ODT_MIME_TYPE) {
    extractedText = await extractTextFromOdt(buffer)
  } else if (mimeType === RTF_MIME_TYPE) {
    extractedText = extractTextFromRtf(buffer.toString('utf8'))
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
  safeHandle('attachments:prepare', async (_event, rawProjectPath: unknown, rawPaths: unknown) => {
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

    const projectRoot = await fs.realpath(projectPath)
    const approvedPaths: string[] = []
    for (const filePath of uniquePaths) {
      const resolvedPath = await fs.realpath(filePath)
      if (!isPathInside(projectRoot, resolvedPath)) {
        const approved = await requestExternalAttachmentAccess(projectRoot, resolvedPath)
        if (!approved) {
          throw new Error(
            `Attachment access denied for file outside project root: ${path.basename(resolvedPath)}`,
          )
        }
      }
      approvedPaths.push(resolvedPath)
    }

    const stats = await Promise.all(approvedPaths.map((filePath) => fs.stat(filePath)))
    const totalSize = stats.reduce((sum, stat) => sum + stat.size, 0)
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      throw new Error(
        `Total attachment size exceeds ${String(MAX_TOTAL_SIZE_BYTES / (1024 * 1024))} MB.`,
      )
    }

    const prepared: PreparedAttachment[] = []
    for (const filePath of approvedPaths) {
      prepared.push(await prepareAttachment(filePath))
    }
    return prepared
  })
}
