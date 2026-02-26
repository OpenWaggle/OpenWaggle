import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { choose } from '@shared/utils/decision'
import { isPathInside } from '@shared/utils/paths'
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
  return choose(ext)
    .case('.pdf', () => 'application/pdf')
    .case('.png', () => 'image/png')
    .case('.jpg', () => 'image/jpeg')
    .case('.jpeg', () => 'image/jpeg')
    .case('.webp', () => 'image/webp')
    .case('.gif', () => 'image/gif')
    .case('.bmp', () => 'image/bmp')
    .case('.svg', () => 'image/svg+xml')
    .case('.md', () => 'text/markdown')
    .case('.json', () => 'application/json')
    .case('.yaml', () => 'application/yaml')
    .case('.yml', () => 'application/yaml')
    .case('.xml', () => 'application/xml')
    .case('.csv', () => 'text/csv')
    .case('.log', () => 'text/plain')
    .case('.docx', () => DOCX_MIME_TYPE)
    .case('.rtf', () => RTF_MIME_TYPE)
    .case('.odt', () => ODT_MIME_TYPE)
    .case('.ts', () => 'text/plain')
    .case('.tsx', () => 'text/plain')
    .case('.js', () => 'text/plain')
    .case('.jsx', () => 'text/plain')
    .case('.mjs', () => 'text/plain')
    .case('.cjs', () => 'text/plain')
    .case('.py', () => 'text/plain')
    .case('.java', () => 'text/plain')
    .case('.go', () => 'text/plain')
    .case('.rs', () => 'text/plain')
    .case('.swift', () => 'text/plain')
    .case('.kt', () => 'text/plain')
    .case('.css', () => 'text/plain')
    .case('.scss', () => 'text/plain')
    .case('.sass', () => 'text/plain')
    .case('.less', () => 'text/plain')
    .case('.html', () => 'text/plain')
    .case('.htm', () => 'text/plain')
    .case('.txt', () => 'text/plain')
    .catchAll(() => null)
}

function normalizeText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n...[truncated]`
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

    return choose(entity)
      .case('amp', () => '&')
      .case('lt', () => '<')
      .case('gt', () => '>')
      .case('quot', () => '"')
      .case('apos', () => "'")
      .catchAll(() => '')
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

// TODO: replace mammoth with actively maintained alternative when available
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
    const { extractText } = await import('unpdf')
    const result = await extractText(new Uint8Array(buffer), { mergePages: true })
    return normalizeText(result.text ?? '')
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

  const extractedText = await choose(kind)
    .case('pdf', () => extractTextFromPdf(buffer))
    .case('image', () => extractTextFromImage(buffer))
    .catchAll(() =>
      choose(mimeType)
        .case(DOCX_MIME_TYPE, () => extractTextFromDocx(buffer))
        .case(ODT_MIME_TYPE, () => extractTextFromOdt(buffer))
        .case(RTF_MIME_TYPE, () => Promise.resolve(extractTextFromRtf(buffer.toString('utf8'))))
        .catchAll(() => Promise.resolve(normalizeText(buffer.toString('utf8')))),
    )

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
