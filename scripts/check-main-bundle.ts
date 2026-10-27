import fs from 'node:fs/promises'
import path from 'node:path'
import { disallowedTopLevelRequires, topLevelRequires } from './main-bundle-requires'

const KIBIBYTE = 1024
const MAIN_BUNDLE_FILES = ['out/main/boot.js', 'out/main/index.js'] as const
/**
 * The boot shim runs before V8's compile cache exists, so it is compiled from source on every
 * launch (src/main/boot.ts). It holds the compile cache setup and the `--version`/`--help` router
 * (34 KB when this budget was set); anything more it imports is paid by every process.
 */
const MAIN_BOOT_FILE = 'out/main/boot.js'
const MAX_MAIN_BOOT_BYTES = 48 * KIBIBYTE

async function main() {
  const failures: string[] = []
  for (const file of MAIN_BUNDLE_FILES) {
    const source = await fs.readFile(path.resolve(file), 'utf8')
    const disallowed = disallowedTopLevelRequires(source)
    if (disallowed.length > 0) {
      failures.push(
        `${file} requires ${disallowed.join(', ')} at its top level; import them where they are used, ` +
          'or route them through scripts/vite/lazy-external-requires.ts.',
      )
    }
    const bytes = Buffer.byteLength(source)
    if (file === MAIN_BOOT_FILE && bytes > MAX_MAIN_BOOT_BYTES) {
      failures.push(`${file} is ${String(bytes)} bytes; budget is ${String(MAX_MAIN_BOOT_BYTES)} bytes.`)
    }
    process.stdout.write(
      `${file}: ${String(bytes)} bytes, ${String(topLevelRequires(source).length)} top-level requires\n`,
    )
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
