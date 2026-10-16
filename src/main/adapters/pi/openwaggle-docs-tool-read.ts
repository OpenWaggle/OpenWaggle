import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from '@earendil-works/pi-coding-agent'
import { isPathInside } from '../../utils/paths'
import type { OpenWaggleDocsToolTopic } from './openwaggle-docs-tool-topics'

const HASH_ALGORITHM = 'sha256'
const HASH_ENCODING = 'hex'
const UTF8_REPLACEMENT_CHARACTER = '\uFFFD'

const SOURCE_LABELS: Readonly<Record<OpenWaggleDocsToolTopic['source'], string>> = {
  openwaggle: 'OpenWaggle docs',
  pi: 'Pi docs',
  extension: 'extension docs',
}

/**
 * An extension doc is read only while it still resolves inside its package and still has the
 * content discovery hashed, so a symlink or a file swapped after discovery cannot reach the agent.
 */
async function readExtensionDoc(
  entry: OpenWaggleDocsToolTopic,
  extension: NonNullable<OpenWaggleDocsToolTopic['extension']>,
) {
  const [realPackagePath, realDocPath] = await Promise.all([
    realpath(extension.packagePath),
    realpath(entry.path),
  ])
  if (!isPathInside(realPackagePath, realDocPath)) {
    throw new Error(`${entry.topic} resolves outside its extension package and cannot be read.`)
  }
  const content = await readFile(realDocPath)
  const hash = createHash(HASH_ALGORITHM).update(content).digest(HASH_ENCODING)
  if (hash !== extension.contentHash) {
    throw new Error(`${entry.topic} changed after it was discovered. Run list or search again.`)
  }
  return content.toString('utf8')
}

export function readDocsToolTopicFile(entry: OpenWaggleDocsToolTopic) {
  return entry.extension ? readExtensionDoc(entry, entry.extension) : readFile(entry.path, 'utf8')
}

/** `line` cut to at most `maxBytes` of UTF-8, without a split character at the end. */
function cutToBytes(line: string, maxBytes: number) {
  const cut = Buffer.from(line, 'utf8').subarray(0, maxBytes).toString('utf8')
  return cut.endsWith(UTF8_REPLACEMENT_CHARACTER) ? cut.slice(0, -1) : cut
}

export interface DocsReadWindow {
  readonly content: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number
  readonly nextOffset?: number
  /** The only line returned was longer than the byte budget and was cut. */
  readonly lineCut?: true
}

/** How many of `lines`, from `startIndex`, fit in Pi `read`'s budget of lines and bytes. */
function linesWithinBudget(lines: readonly string[], startIndex: number) {
  let count = 0
  let bytes = 0
  for (let index = startIndex; index < lines.length && count < DEFAULT_MAX_LINES; index += 1) {
    const lineBytes = Buffer.byteLength(lines[index] ?? '', 'utf8') + (count > 0 ? 1 : 0)
    if (bytes + lineBytes > DEFAULT_MAX_BYTES) break
    bytes += lineBytes
    count += 1
  }
  return count
}

/**
 * Lines from `startLine` (1-based) within Pi `read`'s budget of 2000 lines or 50 KB. A single
 * line over the budget is cut rather than returned whole.
 */
export function docsReadWindow(content: string, startLine: number): DocsReadWindow {
  // Counted as Pi counts them: a final newline ends the last line rather than starting another.
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const totalLines = lines.length
  if (totalLines === 0 && startLine === 1) {
    return { content: '', startLine, endLine: 0, totalLines }
  }
  if (startLine > totalLines) {
    throw new Error(
      `Offset ${startLine} is past the end of the topic, which has ${totalLines} lines.`,
    )
  }
  const count = linesWithinBudget(lines, startLine - 1)
  const lineCut = count === 0
  const endLine = lineCut ? startLine : startLine + count - 1
  return {
    content: lineCut
      ? cutToBytes(lines[startLine - 1] ?? '', DEFAULT_MAX_BYTES)
      : lines.slice(startLine - 1, endLine).join('\n'),
    startLine,
    endLine,
    totalLines,
    ...(lineCut ? { lineCut: true } : {}),
    ...(endLine < totalLines ? { nextOffset: endLine + 1 } : {}),
  }
}

/** The text the model gets: a short header, then the Markdown itself rather than JSON. */
export function docsReadText(input: {
  readonly entry: OpenWaggleDocsToolTopic
  readonly window: DocsReadWindow
  readonly alternatives: readonly string[]
  /** OpenWaggle topics a search for the reference finds, when it resolved to another source. */
  readonly related: readonly string[]
}) {
  const { entry, window } = input
  const header = [
    `Topic: ${entry.topic} (${SOURCE_LABELS[entry.source]}): ${entry.title}`,
    `Path: ${entry.path}`,
    window.totalLines === 0
      ? 'The topic is empty.'
      : `Lines ${window.startLine}-${window.endLine} of ${window.totalLines}.${window.nextOffset ? ` Read on with offset ${window.nextOffset}.` : ''}`,
    ...(window.lineCut
      ? [`Line ${window.startLine} is longer than ${formatSize(DEFAULT_MAX_BYTES)} and was cut.`]
      : []),
    ...(input.alternatives.length > 0 ? [`Also matches: ${input.alternatives.join(', ')}`] : []),
    ...(input.related.length > 0
      ? [`OpenWaggle topics on the same subject: ${input.related.join(', ')}`]
      : []),
    ...(entry.extension
      ? [
          `From the extension ${entry.extension.name ?? entry.extension.id} (${entry.extension.id}), written by its author.`,
        ]
      : []),
  ]
  return `${header.join('\n')}\n\n---\n\n${window.content}`
}
