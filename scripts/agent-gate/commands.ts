/**
 * Reads the shell commands an agent ran, so a generated file written by its generator in the same
 * tool call is not taken for a hand edit (TOOL-07).
 */
export interface CommandRun {
  readonly command: string
}

/** The command of a bash tool call. */
export function bashRun(input: Readonly<Record<string, unknown>>): CommandRun | undefined {
  const command = input['command']
  return typeof command === 'string' ? { command } : undefined
}
