import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
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

/**
 * Lines from `startLine` (1-based) within Pi `read`'s budget of 2000 lines or 50 KB. A single
 * line over the budget is cut rather than returned whole.
 */
export function docsReadWindow(content: string, startLine: number): DocsReadWindow {
  const lines = content.split('\n')
  const totalLines = lines.length
  if (startLine > totalLines) {
    throw new Error(
      `Offset ${startLine} is past the end of the topic, which has ${totalLines} lines.`,
    )
  }
  const truncation = truncateHead(lines.slice(startLine - 1).join('\n'))
  if (truncation.firstLineExceedsLimit) {
    return {
      content: cutToBytes(lines[startLine - 1] ?? '', DEFAULT_MAX_BYTES),
      startLine,
      endLine: startLine,
      totalLines,
      lineCut: true,
      ...(startLine < totalLines ? { nextOffset: startLine + 1 } : {}),
    }
  }
  const endLine = startLine + Math.max(truncation.outputLines, 1) - 1
  return {
    content: truncation.content,
    startLine,
    endLine,
    totalLines,
    ...(endLine < totalLines ? { nextOffset: endLine + 1 } : {}),
  }
}

/** The text the model gets: a short header, then the Markdown itself rather than JSON. */
export function docsReadText(input: {
  readonly entry: OpenWaggleDocsToolTopic
  readonly window: DocsReadWindow
  readonly alternatives: readonly string[]
}) {
  const { entry, window } = input
  const header = [
    `Topic: ${entry.topic} (${SOURCE_LABELS[entry.source]}): ${entry.title}`,
    `Path: ${entry.path}`,
    `Lines ${window.startLine}-${window.endLine} of ${window.totalLines}.${window.nextOffset ? ` Read on with offset ${window.nextOffset}.` : ''}`,
    ...(window.lineCut
      ? [`Line ${window.startLine} is longer than ${formatSize(DEFAULT_MAX_BYTES)} and was cut.`]
      : []),
    ...(input.alternatives.length > 0 ? [`Also matches: ${input.alternatives.join(', ')}`] : []),
    ...(entry.extension
      ? [
          `From the extension ${entry.extension.name ?? entry.extension.id} (${entry.extension.id}), written by its author.`,
        ]
      : []),
  ]
  return `${header.join('\n')}\n\n---\n\n${window.content}`
}
