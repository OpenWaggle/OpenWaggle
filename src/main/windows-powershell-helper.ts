import { win32 } from 'node:path'

/**
 * How OpenWaggle starts its built-in Windows PowerShell helpers (the Session Host's user-only
 * security helper and its headless launcher).
 *
 * The helper program reaches PowerShell on standard input, never on its command line. Antivirus
 * behaviour shields judge a PowerShell process by its command line: Avast's Behavior Shield
 * blocked `powershell.exe -ExecutionPolicy Bypass -EncodedCommand <base64>` as IDP.HELU.PSE96
 * (issue #446), the shape malware droppers use, and the Session Host then never started. A helper
 * started as `powershell.exe -NoLogo -NoProfile -NonInteractive -Command -` carries nothing on its
 * command line to judge, and keeps the default execution policy, which does not apply to commands.
 *
 * `-Command -` runs standard input one line at a time, so the whole program travels as one ASCII
 * line: the script's lines as single-quoted literals, joined into a script block, called with the
 * request as its only argument. The request is JSON whose non-ASCII characters are `\u` escapes,
 * so no console code page can change it, and single-quoted, so it is data, never code.
 */
export const WINDOWS_POWERSHELL_HELPER_ARGUMENTS: readonly string[] = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '-',
]

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/u
const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/gu
const ESCAPE = String.fromCharCode(0x1b)
/** Terminal mode sequences a PowerShell host may write around a helper's output. */
const TERMINAL_CONTROL_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, 'gu')
const UNICODE_ESCAPE_WIDTH = 4
const HEXADECIMAL = 16

/** Windows PowerShell 5.1, which every supported Windows ships, by its absolute path. */
export function windowsPowerShellExecutable(systemRoot: string | undefined) {
  return win32.join(
    systemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
}

function singleQuoted(text: string) {
  return `'${text.replaceAll("'", "''")}'`
}

function asciiJson(value: unknown) {
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error('A PowerShell helper request must be JSON.')
  // JSON keeps every character as an escape, so the request survives any console code page.
  return json.replace(NON_PRINTABLE_ASCII, (character) =>
    Array.from(
      { length: character.length },
      (_, index) =>
        // One escape per UTF-16 code unit, so a character outside the BMP keeps both surrogates.
        `\\u${character.charCodeAt(index).toString(HEXADECIMAL).padStart(UNICODE_ESCAPE_WIDTH, '0')}`,
    ).join(''),
  )
}

/**
 * The single line a helper started with {@link WINDOWS_POWERSHELL_HELPER_ARGUMENTS} reads from
 * standard input: it runs `script`, whose `param([string]$RequestJson)` receives `request` as JSON.
 */
export function windowsPowerShellHelperInput(script: string, request: unknown) {
  const lines = script.split(/\r?\n/u)
  // PowerShell also reads typographic quotes as quotes, so only printable ASCII is literal-safe.
  if (!lines.every((line) => PRINTABLE_ASCII.test(line))) {
    throw new Error('A PowerShell helper script must be printable ASCII.')
  }
  const program = `[string]::Join([char]10, [string[]]@(${lines.map(singleQuoted).join(',')}))`
  return `& ([scriptblock]::Create(${program})) ${singleQuoted(asciiJson(request))}\n`
}

/** A helper's standard output without the terminal mode sequences its host may add, trimmed. */
export function windowsPowerShellHelperOutput(stdout: string) {
  return stdout.replace(TERMINAL_CONTROL_SEQUENCE, '').trim()
}
