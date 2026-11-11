import { execFileSync } from 'node:child_process'
import { getDesktopHelperChildEnv } from '../../env'

/**
 * The per-user Windows registry through `reg.exe`, which every Windows has. Electrobun has no
 * registry API; login items (the `Run` key) and `openwaggle:` link registration need one. Calls
 * are synchronous like the Electron APIs they replace, and rare.
 */
const REG = 'reg.exe'

function reg(args: readonly string[]) {
  return execFileSync(REG, [...args], {
    encoding: 'utf8',
    env: getDesktopHelperChildEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** A `REG_SZ` value, or null when the key or value does not exist. */
export function readRegistryString(key: string, name: string | null) {
  try {
    const output = reg(['query', key, ...(name === null ? ['/ve'] : ['/v', name])])
    const line = output.split(/\r?\n/u).find((candidate) => candidate.includes('REG_SZ'))
    if (!line) return null
    return line.slice(line.indexOf('REG_SZ') + 'REG_SZ'.length).trim()
  } catch {
    return null
  }
}

export function writeRegistryString(key: string, name: string | null, value: string) {
  reg(['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', value, '/f'])
}

export function deleteRegistryValue(key: string, name: string) {
  try {
    reg(['delete', key, '/v', name, '/f'])
  } catch {
    // Already absent.
  }
}
