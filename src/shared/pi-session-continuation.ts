/**
 * The Pi continuation choice (ADR 0051): when a person sends from the composer in a Session whose
 * Pi file's latest prompt came from outside OpenWaggle, such as the `pi` CLI, they choose to
 * continue it in OpenWaggle or keep running it in pi. The choice may be remembered per project,
 * for that person only, in their own app settings.
 */
export const PI_SESSION_CONTINUATION_CHOICES = ['openwaggle', 'pi'] as const

export type PiSessionContinuationChoice = (typeof PI_SESSION_CONTINUATION_CHOICES)[number]

export function isPiSessionContinuationChoice(
  value: unknown,
): value is PiSessionContinuationChoice {
  return PI_SESSION_CONTINUATION_CHOICES.some((choice) => choice === value)
}

export type PiSessionCommandShell = 'posix' | 'powershell'

function quoted(value: string, shell: PiSessionCommandShell) {
  return shell === 'powershell'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", `'\\''`)}'`
}

/** The command that continues a Pi session file in the `pi` CLI, quoted for the shell. */
export function piSessionContinueCommand(piSessionFile: string, shell: PiSessionCommandShell) {
  return `pi --session ${quoted(piSessionFile, shell)}`
}
