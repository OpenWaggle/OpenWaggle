/**
 * What a perf or eval harness must undo when it is interrupted. The app and every `openwaggle`
 * CLI it launches run in their own process group (perf-app.ts), so Ctrl-C reaches only the harness,
 * and Node exits on SIGINT without running `finally` blocks: the hidden GUI would keep its CDP and
 * inspector ports open, the profile's Host would keep running, and the throwaway profile would stay
 * on disk. Launched process groups and live profiles register here; on SIGINT, SIGTERM or SIGHUP
 * the process groups are stopped first, then the profiles disposed, then the harness exits with
 * 128 + the signal number. A second signal during that cleanup exits at once.
 */

export type InterruptPhase = 'process' | 'profile'
type Cleanup = () => Promise<void>
type SignalListener = (signal: NodeJS.Signals) => void

export interface SignalTarget {
  on(event: NodeJS.Signals, listener: SignalListener): unknown
  off(event: NodeJS.Signals, listener: SignalListener): unknown
}

const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const satisfies readonly NodeJS.Signals[]
const SIGNAL_EXIT_BASE = 128
const SIGNAL_NUMBERS: Readonly<Record<(typeof HANDLED_SIGNALS)[number], number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }
const PHASE_ORDER: readonly InterruptPhase[] = ['process', 'profile']

function exitCodeOf(signal: NodeJS.Signals) {
  const number = HANDLED_SIGNALS.find((handled) => handled === signal)
  return SIGNAL_EXIT_BASE + (number ? SIGNAL_NUMBERS[number] : SIGNAL_NUMBERS.SIGTERM)
}

export function createInterruptCleanup(target: SignalTarget, exit: (code: number) => void) {
  const entries = new Set<{ readonly phase: InterruptPhase; readonly cleanup: Cleanup }>()
  let cleaning = false

  async function run() {
    for (const phase of PHASE_ORDER) {
      const due = [...entries].filter((entry) => entry.phase === phase)
      for (const entry of due) entries.delete(entry)
      await Promise.allSettled(due.map((entry) => entry.cleanup()))
    }
  }

  const onSignal: SignalListener = (signal) => {
    if (cleaning) {
      exit(exitCodeOf(signal))
      return
    }
    cleaning = true
    process.stderr.write(`${signal}: stopping the apps and Hosts this harness started, removing its profiles…\n`)
    void run().finally(() => exit(exitCodeOf(signal)))
  }

  function setListening(listening: boolean) {
    for (const signal of HANDLED_SIGNALS) {
      if (listening) target.on(signal, onSignal)
      else target.off(signal, onSignal)
    }
  }

  /** Registers `cleanup` for an interrupt; call the returned function once it is no longer due. */
  function register(phase: InterruptPhase, cleanup: Cleanup) {
    const entry = { phase, cleanup }
    if (entries.size === 0) setListening(true)
    entries.add(entry)
    return () => {
      if (!entries.delete(entry) || entries.size > 0 || cleaning) return
      setListening(false)
    }
  }

  return { register, run, pending: () => entries.size }
}

/** The harness process's registry. */
export const interruptCleanup = createInterruptCleanup(process, (code) => process.exit(code))
