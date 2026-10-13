import type { McpMigrationFs } from '../migration-fs'

/** In-memory file system for migration tests. Paths are absolute strings. */
export class MemoryMigrationFs implements McpMigrationFs {
  readonly files = new Map<string, string>()
  readonly writes: string[] = []
  failWritesTo: string | undefined

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [filePath, content] of Object.entries(initial)) this.files.set(filePath, content)
  }

  readText(filePath: string) {
    return Promise.resolve(this.files.get(filePath))
  }

  writeTextAtomic(filePath: string, content: string) {
    if (this.failWritesTo === filePath) {
      return Promise.reject(new Error(`EACCES: permission denied, open '${filePath}'`))
    }
    this.files.set(filePath, content)
    this.writes.push(filePath)
    return Promise.resolve()
  }

  createTextExclusive(filePath: string, content: string) {
    if (this.files.has(filePath)) return Promise.resolve(false)
    this.files.set(filePath, content)
    this.writes.push(filePath)
    return Promise.resolve(true)
  }

  json(filePath: string): unknown {
    const content = this.files.get(filePath)
    if (content === undefined) throw new Error(`No file at ${filePath}`)
    const parsed: unknown = JSON.parse(content)
    return parsed
  }
}

export function jsonText(value: unknown, indent: number | string = 2) {
  return `${JSON.stringify(value, null, indent)}\n`
}
