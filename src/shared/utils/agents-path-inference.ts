interface InferAgentsCandidatePathsInput {
  readonly text: string
  readonly attachmentPaths?: readonly string[]
  readonly maxCandidates?: number
}

const DEFAULT_MAX_CANDIDATES = 5
const EXPLICIT_PATH_REGEX = /(?:^|\s)path:([^\s]+)/gi
const SLASH_PATH_TOKEN_REGEX = /(?:^|\s)([./~]?[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+)/g
const WINDOWS_PATH_TOKEN_REGEX = /(?:^|\s)([a-zA-Z]:\\[^\s`"'<>]+)/g
const FENCED_BLOCK_REGEX = /```[\w-]*\n([\s\S]*?)```/g

export function inferAgentsCandidatePaths(input: InferAgentsCandidatePathsInput): string[] {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  if (maxCandidates <= 0) return []

  const ordered: string[] = []
  const seen = new Set<string>()

  const addCandidate = (value: string): void => {
    if (ordered.length >= maxCandidates) return
    const normalized = normalizeCandidate(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    ordered.push(normalized)
  }

  for (const attachmentPath of input.attachmentPaths ?? []) {
    addCandidate(attachmentPath)
  }

  for (const explicitPath of extractMatches(input.text, EXPLICIT_PATH_REGEX)) {
    addCandidate(explicitPath)
  }

  for (const pathLike of extractFencedPathLines(input.text)) {
    addCandidate(pathLike)
  }

  for (const tokenPath of extractMatches(input.text, WINDOWS_PATH_TOKEN_REGEX)) {
    addCandidate(tokenPath)
  }

  for (const tokenPath of extractMatches(input.text, SLASH_PATH_TOKEN_REGEX)) {
    addCandidate(tokenPath)
  }

  return ordered
}

function extractMatches(text: string, regex: RegExp): string[] {
  regex.lastIndex = 0
  const matches: string[] = []
  let match: RegExpExecArray | null = regex.exec(text)
  while (match) {
    if (match[1]) {
      matches.push(match[1])
    }
    match = regex.exec(text)
  }
  return matches
}

function extractFencedPathLines(text: string): string[] {
  FENCED_BLOCK_REGEX.lastIndex = 0
  const lines: string[] = []
  let blockMatch: RegExpExecArray | null = FENCED_BLOCK_REGEX.exec(text)
  while (blockMatch) {
    const block = blockMatch[1] ?? ''
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.includes(' ') || line.includes('\t')) continue
      if (!line.includes('/') && !line.includes('\\')) continue
      lines.push(line)
    }

    blockMatch = FENCED_BLOCK_REGEX.exec(text)
  }
  return lines
}

function normalizeCandidate(value: string): string | null {
  let normalized = value.trim()
  if (!normalized) return null

  normalized = normalized.replaceAll(/^[`"'([{<]+|[`"')\]}>.,;:!?]+$/g, '')
  if (!normalized) return null

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return null
  }

  if (!normalized.includes('/') && !normalized.includes('\\')) {
    return null
  }

  return normalized
}
