import { Context } from 'effect'
import type { AppLifecycleShape } from './app-lifecycle'
import type { AppPathsShape } from './app-paths'
import type { SystemIntegrationShape } from './system-integration'

/**
 * The few shell capabilities the boot shim (`src/main/boot.ts`) uses before the main bundle
 * loads: the build identity, the app's version, paths and command line, and a quick exit for a
 * top-level CLI answer. It is a view of the full ports, not new behavior; a shell's full adapters
 * reuse these same functions. It stays apart so the shim loads none of the full adapters and keeps
 * within its size budget (`check:main-bundle`).
 */
export type BootShellShape = Pick<AppPathsShape, 'applyBuildIdentity' | 'appRoot' | 'userData'> &
  Pick<AppLifecycleShape, 'version' | 'isPackaged' | 'exit' | 'commandLine'> &
  Pick<SystemIntegrationShape, 'setActivationPolicy'>

export class BootShell extends Context.Tag('@openwaggle/BootShell')<BootShell, BootShellShape>() {}
