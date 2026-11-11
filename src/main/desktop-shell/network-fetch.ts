import { electrobunNetworkFetch } from '../adapters/electrobun/electrobun-network-fetch'
import type { NetworkFetchShape } from '../ports/desktop-shell/network-fetch'

/** The desktop shell's NetworkFetch (ADR 0064), bound to its Electrobun adapter. */
export const networkFetch: NetworkFetchShape = electrobunNetworkFetch
