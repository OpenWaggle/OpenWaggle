const PACKAGED_ARGUMENT_OFFSET = 1
const DEVELOPMENT_ARGUMENT_OFFSET = 2

export function applicationCliArguments(
  argv: readonly string[],
  options: { readonly isPackaged: boolean },
) {
  return argv.slice(options.isPackaged ? PACKAGED_ARGUMENT_OFFSET : DEVELOPMENT_ARGUMENT_OFFSET)
}
