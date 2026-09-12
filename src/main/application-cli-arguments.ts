const EXECUTABLE_ARGUMENT_OFFSET = 1
const ELECTRON_RUNTIME_PREFIX_SWITCHES = new Set([
  '--no-sandbox',
  '--disable-logging',
  '--log-level=3',
])

function afterRuntimePrefix(argv: readonly string[], start: number) {
  let offset = start
  while (ELECTRON_RUNTIME_PREFIX_SWITCHES.has(argv[offset] ?? '')) offset += 1
  return offset
}

export function applicationCliArguments(
  argv: readonly string[],
  options: { readonly isPackaged: boolean },
) {
  // Electron retains these explicit runtime switches in process.argv. Consume only their
  // leading prefix, never scan for a command inside message text or rewrite application options.
  let offset = afterRuntimePrefix(argv, EXECUTABLE_ARGUMENT_OFFSET)
  if (!options.isPackaged) {
    // An unknown switch is not an application path and must not be silently skipped.
    if (argv[offset]?.startsWith('-')) return argv.slice(offset)
    offset += 1
    offset = afterRuntimePrefix(argv, offset)
  }
  // The launcher separates Electron switches from application arguments. Consume only
  // this boundary: a second terminator or later message token belongs to the application.
  if (argv[offset] === '--') offset += 1
  return argv.slice(offset)
}
