import { createConsoleTerminal, readConsoleOutput, type ProbedPty } from './native-pty-probe-support'

export function observePtyOutput(source: Pick<ProbedPty, 'onData'>, consoleOutput = false) {
  let output = ''
  let visibleOutput = ''
  const terminal = consoleOutput ? createConsoleTerminal() : undefined
  const waiters = new Map<string, Set<() => void>>()
  const publish = () => {
    visibleOutput = terminal ? readConsoleOutput(terminal) : output
    for (const [marker, resolves] of waiters) {
      if (!visibleOutput.includes(marker)) continue
      waiters.delete(marker)
      for (const resolve of resolves) resolve()
    }
  }
  const subscription = source.onData((data) => {
    output += data
    if (terminal) terminal.write(data, publish)
    else publish()
  })
  return {
    dispose: () => {
      subscription.dispose()
      terminal?.dispose()
    },
    read: () => output,
    readVisible: () => visibleOutput,
    resize: (columns: number, rows: number) => terminal?.resize(columns, rows),
    waitFor: (marker: string) => {
      if (visibleOutput.includes(marker)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const resolves = waiters.get(marker) ?? new Set<() => void>()
        resolves.add(resolve)
        waiters.set(marker, resolves)
      })
    },
  }
}
