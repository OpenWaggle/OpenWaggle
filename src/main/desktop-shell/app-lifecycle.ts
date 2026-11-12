import { electronAppLifecycle } from '../adapters/electron/electron-app-lifecycle'
import type { AppLifecycleShape } from '../ports/desktop-shell/app-lifecycle'

/** The desktop shell's AppLifecycle (ADR 0064); the shell switch changes only this binding. */
export const appLifecycle: AppLifecycleShape = electronAppLifecycle
