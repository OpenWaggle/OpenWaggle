import { electrobunAppLifecycle } from '../adapters/electrobun/electrobun-app-lifecycle'
import type { AppLifecycleShape } from '../ports/desktop-shell/app-lifecycle'

/** The desktop shell's AppLifecycle (ADR 0064), bound to its Electrobun adapter. */
export const appLifecycle: AppLifecycleShape = electrobunAppLifecycle
