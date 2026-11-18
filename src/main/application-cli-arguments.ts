const EXECUTABLE_ARGUMENT_OFFSET = 1
const ELECTRON_RUNTIME_PREFIX_SWITCHES = new Set([
  '--no-sandbox',
  '--disable-logging',
  '--log-level=3',
  // Credential store switches QA starts the GUI with, which the GUI forwards to its Host.
  '--use-mock-keychain',
  // The GPU-off switch the GUI forwards to its Host, the common workaround for a broken GPU
  // or Vulkan stack (same class as the Ozone backend switches below).
  '--disable-gpu',
])
/** Linux Chromium's credential store choice, such as --password-store=basic. */
const PASSWORD_STORE_SWITCH = /^--password-store=[a-z0-9-]+$/
/** Chromium's accepted Ozone backend values (x11, wayland), shared with the Host's launcher. */
const OZONE_PLATFORM_VALUE = /^[a-z0-9-]+$/
/** Linux Chromium's display backend selection, such as --ozone-platform=x11 or its -hint form. */
const OZONE_PLATFORM_SWITCH = /^--ozone-platform(?:-hint)?=[a-z0-9-]+$/

/**
 * Whether an Ozone platform value the GUI carries can also reach the Host as a leading runtime
 * switch: the launcher forwards a value if and only if the Host's parser recognizes the switch it
 * builds from it, so the two halves of the #499 fix cannot drift apart again.
 */
export function isOzonePlatformValue(value: string) {
  return OZONE_PLATFORM_VALUE.test(value)
}

function isRuntimePrefixSwitch(argument: string) {
  return (
    ELECTRON_RUNTIME_PREFIX_SWITCHES.has(argument) ||
    PASSWORD_STORE_SWITCH.test(argument) ||
    OZONE_PLATFORM_SWITCH.test(argument)
  )
}

function afterRuntimePrefix(argv: readonly string[], start: number) {
  let offset = start
  while (isRuntimePrefixSwitch(argv[offset] ?? '')) offset += 1
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
