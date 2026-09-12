import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'

export interface TerminalHistoryCacheSnapshot {
  readonly states: ReadonlyArray<{
    readonly key: TerminalKey
    readonly bytes: number
    readonly lines: number
  }>
  readonly workingDirectories: ReadonlyArray<{
    readonly key: TerminalKey
    readonly cwd: string
  }>
}

export interface TerminalHistoryStore {
  read(key: TerminalKey): Promise<string>
  registerWorkingDirectory(key: TerminalKey, cwd: string): Promise<void>
  append(key: TerminalKey, chunk: string): void
  truncate(key: TerminalKey): Promise<void>
  remove(key: TerminalKey): Promise<void>
  removeForOwner(ownerKey: TerminalOwnerKey): Promise<void>
  removeForPath(directoryPath: string): Promise<void>
  move(fromKey: TerminalKey, toKey: TerminalKey): Promise<void>
  moveOwner(fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey): Promise<void>
  /** Release in-memory bookkeeping without deleting durable replay files. */
  release(key: TerminalKey): Promise<void>
  flush(): Promise<void>
  /** Test-only cache visibility; this adapter is not part of the app API. */
  cacheSnapshotForTests(): TerminalHistoryCacheSnapshot
}
