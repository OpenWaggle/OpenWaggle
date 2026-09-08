export const TERMINAL_UNKNOWN_EXIT_CODE = -1

/** Keep untrusted native-addon exit payloads inside the number contract. */
export function normalizeTerminalExitCode(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : TERMINAL_UNKNOWN_EXIT_CODE
}
