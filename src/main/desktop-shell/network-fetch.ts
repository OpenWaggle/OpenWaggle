import { electronNetworkFetch } from '../adapters/electron/electron-network-fetch'
import type { NetworkFetchShape } from '../ports/desktop-shell/network-fetch'

/** The desktop shell's NetworkFetch (ADR 0064); the shell switch changes only this binding. */
export const networkFetch: NetworkFetchShape = electronNetworkFetch
