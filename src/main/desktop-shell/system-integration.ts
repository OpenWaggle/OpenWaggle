import { electrobunSystemIntegration } from '../adapters/electrobun/electrobun-system-integration'
import type { SystemIntegrationShape } from '../ports/desktop-shell/system-integration'

/** The desktop shell's SystemIntegration (ADR 0064), bound to its Electrobun adapter. */
export const systemIntegration: SystemIntegrationShape = electrobunSystemIntegration
