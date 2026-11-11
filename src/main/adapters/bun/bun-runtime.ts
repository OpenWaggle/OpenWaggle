/**
 * The parts of Bun's runtime globals the main process uses (ADR 0064), typed here and read
 * through a runtime check instead of Bun's global types, which retype `fetch` for every module
 * and test. Each accessor throws outside Bun.
 */

export interface BunTerminalOptions {
  readonly cols: number
  readonly rows: number
  readonly name: string
  readonly data: (terminal: BunTerminal, data: Uint8Array) => void
  /** The PTY reached end of file (every slave descriptor closed) or failed to read. */
  readonly exit: (terminal: BunTerminal, status: number, signal: string | null) => void
}

export interface BunTerminal {
  readonly closed: boolean
  write(data: string | Uint8Array): number
  resize(cols: number, rows: number): void
  close(): void
}

export interface BunSubprocess {
  readonly pid: number
  readonly exited: Promise<number>
  readonly exitCode: number | null
  readonly signalCode: string | null
  readonly terminal?: BunTerminal
  kill(signal?: number | string): void
}

export interface BunSpawnOptions {
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly terminal: BunTerminalOptions
}

interface BunRuntime {
  readonly spawn: (argv: readonly string[], options: BunSpawnOptions) => BunSubprocess
}

function isBunRuntime(value: unknown): value is BunRuntime {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'spawn') === 'function'
  )
}

function bunRuntime(): BunRuntime {
  const bun: unknown = Reflect.get(globalThis, 'Bun')
  if (!isBunRuntime(bun)) throw new Error('This needs the Bun runtime.')
  return bun
}

/** `Bun.spawn` with a pseudo-terminal (POSIX only in Bun 1.4). */
export function spawnWithTerminal(argv: readonly string[], options: BunSpawnOptions) {
  return bunRuntime().spawn(argv, options)
}
