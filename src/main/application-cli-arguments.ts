/**
 * Bun's `process.argv`: the runtime, then the script it runs (`out/main/boot.js`, or in the app
 * the Hutch entry that imports it), then the application's own arguments.
 */
const SCRIPT_ARGUMENT_OFFSET = 2
const RUNTIME_PREFIX_SWITCHES = new Set([
  '--no-sandbox',
  '--disable-logging',
  '--log-level=3',
  // Credential store switches QA starts the GUI with, which the GUI forwards to its Host.
  '--use-mock-keychain',
])
/** Linux Chromium's credential store choice, such as --password-store=basic. */
const PASSWORD_STORE_SWITCH = /^--password-store=[a-z0-9-]+$/

function isRuntimePrefixSwitch(argument: string) {
  return RUNTIME_PREFIX_SWITCHES.has(argument) || PASSWORD_STORE_SWITCH.test(argument)
}

function afterRuntimePrefix(argv: readonly string[], start: number) {
  let offset = start
  while (isRuntimePrefixSwitch(argv[offset] ?? '')) offset += 1
  return offset
}

export function applicationCliArguments(argv: readonly string[]) {
  // A Host launch keeps the desktop app's explicit runtime switches before its command. Consume
  // only their leading prefix, never scan for a command inside message text or rewrite options.
  let offset = afterRuntimePrefix(argv, SCRIPT_ARGUMENT_OFFSET)
  // A launcher may separate its switches from application arguments. Consume only this boundary:
  // a second terminator or later message token belongs to the application.
  if (argv[offset] === '--') offset += 1
  return argv.slice(offset)
}
