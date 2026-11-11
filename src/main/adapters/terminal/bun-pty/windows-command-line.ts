/**
 * The command line and environment block `CreateProcessW` takes (ADR 0064), built as node-pty
 * and libuv build them: arguments quoted by the MSVC runtime's rules, and `KEY=value` pairs
 * sorted case-insensitively, each NUL-terminated, with a final NUL.
 */
const NEEDS_QUOTES = /[\s"]/u
/** A backslash run before a quote doubles, and one more escapes the quote. */
const BACKSLASH_DOUBLING = 2

/** One argument, quoted so `CommandLineToArgvW` reads it back unchanged. */
export function quoteWindowsArgument(argument: string) {
  if (argument.length > 0 && !NEEDS_QUOTES.test(argument)) return argument
  let quoted = '"'
  let backslashes = 0
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1
      continue
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * BACKSLASH_DOUBLING + 1)
    } else {
      quoted += '\\'.repeat(backslashes)
    }
    backslashes = 0
    quoted += character
  }
  return `${quoted}${'\\'.repeat(backslashes * BACKSLASH_DOUBLING)}"`
}

export function windowsCommandLine(file: string, args: readonly string[]) {
  return [file, ...args].map(quoteWindowsArgument).join(' ')
}

/** A UTF-16 environment block; a variable named with `=` (the drive cwd ones) stays first. */
export function windowsEnvironmentBlock(environment: Readonly<Record<string, string>>) {
  const entries = Object.entries(environment)
    .filter(([key]) => key.length > 0)
    .sort(([left], [right]) => {
      const a = left.toUpperCase()
      const b = right.toUpperCase()
      return a < b ? -1 : a > b ? 1 : 0
    })
  const text = `${entries.map(([key, value]) => `${key}=${value}\0`).join('')}\0`
  const units = new Uint16Array(text.length + 1)
  for (let index = 0; index < text.length; index += 1) units[index] = text.charCodeAt(index)
  return units
}
