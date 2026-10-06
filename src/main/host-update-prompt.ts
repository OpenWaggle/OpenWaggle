import { closeSync, openSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { ReadStream, WriteStream } from 'node:tty'

export type UpdateRunChoice = 'when-idle' | 'now' | 'cancel'

export interface PromptTerminal {
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  readonly close: () => void
}

const RUN_PROMPT_ANSWERS: Readonly<Record<string, UpdateRunChoice>> = {
  '': 'when-idle',
  w: 'when-idle',
  n: 'now',
  c: 'cancel',
}

export function runsNoun(activeRuns: number) {
  return activeRuns === 1 ? '1 agent run' : `${activeRuns} agent runs`
}

function runsPhrase(activeRuns: number) {
  return `${runsNoun(activeRuns)} ${activeRuns === 1 ? 'is' : 'are'}`
}

/** The controlling terminal as TTY streams, which close cleanly unlike a file read of /dev/tty. */
function openControllingTerminal(): PromptTerminal | null {
  if (process.platform === 'win32') return null
  let inputDescriptor: number | undefined
  try {
    inputDescriptor = openSync('/dev/tty', 'r')
    const input = new ReadStream(inputDescriptor)
    const output = new WriteStream(openSync('/dev/tty', 'w'))
    return {
      input,
      output,
      close: () => {
        input.destroy()
        output.destroy()
      },
    }
  } catch {
    if (inputDescriptor !== undefined) closeSync(inputDescriptor)
    return null
  }
}

/**
 * The terminal to ask on. Not stdin when it is redirected: `curl … | bash` gives the installer the
 * script as its stdin, and with stderr redirected the question would not be seen.
 */
export function openPromptTerminal(): PromptTerminal | null {
  if (process.stdin.isTTY && process.stderr.isTTY) {
    return { input: process.stdin, output: process.stderr, close: () => undefined }
  }
  return openControllingTerminal()
}

/**
 * Asks what to do with active agent Runs before an update, offering what Restart to update offers.
 * Without a terminal it waits for the Runs, as Restart when idle does by default. Ctrl-C, Ctrl-D
 * or the end of input cancels the update.
 */
export async function askRunHandling(
  activeRuns: number,
  terminal: PromptTerminal | null,
  notice: (text: string) => void,
): Promise<UpdateRunChoice> {
  if (!terminal) {
    notice(`${runsPhrase(activeRuns)} still working; waiting for them to finish (Ctrl-C cancels).`)
    return 'when-idle'
  }
  const question = `${runsPhrase(activeRuns)} still working. Wait until they finish [W], stop them now [n], or cancel [c]? `
  const prompt = createInterface({ input: terminal.input, output: terminal.output })
  const aborted = new AbortController()
  prompt.once('SIGINT', () => aborted.abort())
  prompt.once('close', () => aborted.abort())
  try {
    while (true) {
      const answer = await prompt.question(question, { signal: aborted.signal }).catch(() => 'c')
      const choice = RUN_PROMPT_ANSWERS[answer.trim().toLowerCase().slice(0, 1)]
      if (choice) return choice
    }
  } finally {
    prompt.close()
    terminal.close()
  }
}
