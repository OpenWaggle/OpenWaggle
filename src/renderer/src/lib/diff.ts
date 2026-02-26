import { createPatch } from 'diff'

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffResult {
  lines: DiffLine[]
  additions: number
  deletions: number
}

export function computeDiff(oldContent: string, newContent: string, filePath: string): DiffResult {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: 3 })

  const lines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  let oldLine = 0
  let newLine = 0

  const patchLines = patch.split('\n')

  for (const line of patchLines) {
    // Skip file headers
    if (
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue
    }

    // Parse hunk header
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      continue
    }

    if (line.startsWith('+')) {
      lines.push({
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      })
      additions++
      newLine++
      continue
    }

    if (line.startsWith('-')) {
      lines.push({
        type: 'remove',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      })
      deletions++
      oldLine++
      continue
    }

    if (line.startsWith(' ')) {
      lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine++
      newLine++
    }
    // Skip "\ No newline at end of file" lines
  }

  return { lines, additions, deletions }
}
