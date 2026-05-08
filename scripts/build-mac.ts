import { spawnSync } from 'node:child_process'
import process from 'node:process'

const FAILURE_EXIT_CODE = 1
const APPLE_SILICON_ARCH = 'arm64'
const INTEL_ARCH = 'x64'

function currentMacBuildArch(): string {
  return process.arch === APPLE_SILICON_ARCH ? APPLE_SILICON_ARCH : INTEL_ARCH
}

const result = spawnSync('pnpm', ['exec', 'electron-builder', '--mac', `--${currentMacBuildArch()}`], {
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(FAILURE_EXIT_CODE)
}

process.exit(result.status ?? FAILURE_EXIT_CODE)
