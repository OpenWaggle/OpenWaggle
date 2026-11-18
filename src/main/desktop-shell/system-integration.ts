import { electronSystemIntegration } from '../adapters/electron/electron-system-integration'
import type { SystemIntegrationShape } from '../ports/desktop-shell/system-integration'

/** The desktop shell's SystemIntegration (ADR 0064), bound to its Electron adapter. */
export const systemIntegration: SystemIntegrationShape = electronSystemIntegration
