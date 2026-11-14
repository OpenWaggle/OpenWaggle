import { countO200kTokens } from '../perf/first-turn-prefix/prefix-tokens'
import type { Violation } from './violation'
import { namedGroups } from '@shared/utils/regex-named-groups'

/**
 * Project memory is loaded by topic (ADR 0064). `MEMORY.md` is the index every agent reads first,
 * so it stays small; each topic file under `.agents/memory/` is read only when its trigger matches,
 * and the cap keeps one load cheap. Counted in o200k tokens, the tokenizer the first-turn prefix
 * budget uses. A topic that reaches its cap is split, not trimmed.
 */
const MEMORY_INDEX_FILE = 'MEMORY.md'
const MEMORY_TOPIC_DIRECTORY = '.agents/memory/'
export const MEMORY_INDEX_TOKEN_CAP = 2_000
export const MEMORY_TOPIC_TOKEN_CAP = 12_000
const SUMMARY_MIN_LINES = 3
const SUMMARY_MAX_LINES = 6
/** The title line and the blank line after it. */
const SUMMARY_FIRST_LINE = 2

function isMemoryTopic(file: string) {
  return (
    file.startsWith(MEMORY_TOPIC_DIRECTORY) &&
    file.endsWith('.md') &&
    !file.slice(MEMORY_TOPIC_DIRECTORY.length).includes('/')
  )
}

/** A topic opens with a `# Title` line, a blank line, then a 3-6 line summary paragraph. */
function summaryViolation(file: string, contents: string) {
  const lines = contents.split('\n')
  const summary: string[] = []
  for (const line of lines.slice(SUMMARY_FIRST_LINE)) {
    if (line.trim() === '') break
    summary.push(line)
  }
  const opensWithSummary =
    lines[0]?.startsWith('# ') === true &&
    lines[1] === '' &&
    !summary.some((line) => line.startsWith('#')) &&
    summary.length >= SUMMARY_MIN_LINES &&
    summary.length <= SUMMARY_MAX_LINES
  if (opensWithSummary) return [] satisfies Violation[]
  return [
    {
      file,
      message: `A memory topic opens with a "# Title" line and a ${SUMMARY_MIN_LINES}-${SUMMARY_MAX_LINES} line summary of what it covers and when to load it.`,
    },
  ] satisfies Violation[]
}

function sizeViolation(file: string, contents: string, cap: number, remedy: string) {
  const tokens = countO200kTokens(contents)
  if (tokens <= cap) return [] satisfies Violation[]
  return [
    {
      file,
      detail: `${tokens} > ${cap} o200k tokens`,
      message: `Project memory file is over its cap. ${remedy}`,
    },
  ] satisfies Violation[]
}

export function collectAgentMemoryFileViolations(file: string, contents: string) {
  if (file === MEMORY_INDEX_FILE) {
    return sizeViolation(
      file,
      contents,
      MEMORY_INDEX_TOKEN_CAP,
      'Keep MEMORY.md to one line per topic; findings belong in .agents/memory/<topic>.md.',
    ) satisfies Violation[]
  }
  if (!isMemoryTopic(file)) return [] satisfies Violation[]
  return [
    ...summaryViolation(file, contents),
    ...sizeViolation(
      file,
      contents,
      MEMORY_TOPIC_TOKEN_CAP,
      'Split the topic into narrower topic files and index each one in MEMORY.md.',
    ),
  ] satisfies Violation[]
}

/** Every topic file is indexed in MEMORY.md, and every indexed topic exists. */
export function collectAgentMemoryIndexViolations(contentsByFile: ReadonlyMap<string, string>) {
  const index = contentsByFile.get(MEMORY_INDEX_FILE)
  if (index === undefined) return [] satisfies Violation[]
  const linked = new Set(
    [...index.matchAll(/\]\((?<target>\.agents\/memory\/[^)\s]+\.md)\)/gu)].flatMap(
      (match) => namedGroups(match, ['target'])?.target ?? [],
    ),
  )
  const topics = [...contentsByFile.keys()].filter(isMemoryTopic)
  return [
    ...topics
      .filter((topic) => !linked.has(topic))
      .map((topic) => ({
        file: topic,
        message: 'Index every memory topic in MEMORY.md with one line naming when to load it.',
      })),
    ...[...linked]
      .filter((target) => !contentsByFile.has(target))
      .map((target) => ({
        file: MEMORY_INDEX_FILE,
        detail: target,
        message: 'MEMORY.md links a memory topic that does not exist.',
      })),
  ] satisfies Violation[]
}
