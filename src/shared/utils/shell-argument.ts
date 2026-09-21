export function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function quotePowerShellArgument(value: string): string {
  // PowerShell's CharTraits.IsSingleQuote also recognizes U+2018 through U+201B.
  return `'${value.replace(/['\u2018-\u201b]/g, (quote) => quote + quote)}'`
}
