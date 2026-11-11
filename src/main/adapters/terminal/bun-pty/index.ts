import type { PtyModule } from '../terminal-pty-backend'
import { loadPosixKernel } from './posix-kernel'
import { spawnPosixPty } from './posix-pty'

/**
 * The terminal backend (ADR 0030, ADR 0064): `Bun.spawn({ terminal })` with the identity
 * primitives of `posix-kernel.ts` on macOS and Linux, ConPTY through `bun:ffi` on Windows
 * (`windows-conpty.ts`). It replaces the patched node-pty addon, which never delivered output
 * under Bun.
 */
export async function loadBunPtyModule(platform = process.platform): Promise<PtyModule> {
  if (platform === 'win32') {
    const { loadWindowsPtyModule } = await import('./windows-conpty')
    return loadWindowsPtyModule()
  }
  const kernel = await loadPosixKernel(platform)
  if (!kernel) throw new Error(`Terminals are not supported on ${platform}.`)
  return {
    spawn: (file, args, options) => spawnPosixPty(kernel, file, args, options),
    native: kernel,
  }
}
