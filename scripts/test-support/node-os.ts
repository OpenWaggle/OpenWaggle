/**
 * The `node:os` the Vitest tiers resolve for code they transform (see `BUN_RUNTIME_ALIASES`), so
 * `homedir` follows the per-file temporary HOME on Bun as it does on Node. Patching the builtin
 * alone is not enough: Bun fixes a builtin's ESM named exports when the first importer loads it,
 * and Vitest loads `node:os` before any setup file runs, so `import { homedir } from 'node:os'`
 * would keep the startup value.
 */
import { followHomeEnvironmentOnBun } from './bun-home-directory'

const os = process.getBuiltinModule('node:os')
followHomeEnvironmentOnBun(process.versions, os)

export function homedir() {
  return os.homedir()
}

export const {
  arch,
  availableParallelism,
  constants,
  cpus,
  devNull,
  endianness,
  EOL,
  freemem,
  getPriority,
  hostname,
  loadavg,
  machine,
  networkInterfaces,
  platform,
  release,
  setPriority,
  tmpdir,
  totalmem,
  type,
  uptime,
  userInfo,
  version,
} = os

export default os
