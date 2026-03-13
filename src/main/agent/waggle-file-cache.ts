export interface WaggleFileCacheEntry {
  readonly content: string
  readonly readBy: string
}

/**
 * Per-session cache for file reads performed during a Waggle collaboration run.
 * Keys are resolved absolute file paths. Shared across all agents in a single
 * waggle session so that Agent B doesn't re-read files that Agent A already read.
 *
 * Created at the start of runWaggleSequential() and cleared in a finally block.
 */
export class WaggleFileCache {
  private readonly entries = new Map<string, WaggleFileCacheEntry>()

  get(filePath: string): WaggleFileCacheEntry | undefined {
    return this.entries.get(filePath)
  }

  set(filePath: string, content: string, agentLabel: string): void {
    this.entries.set(filePath, { content, readBy: agentLabel })
  }

  has(filePath: string): boolean {
    return this.entries.has(filePath)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
