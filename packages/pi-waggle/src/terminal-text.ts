import { truncateToWidth } from '@earendil-works/pi-tui'

const TERMINAL_ELLIPSIS = '…'

export function singleTerminalLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

export function truncateTerminalLine(value: string, width: number): string {
  return truncateToWidth(singleTerminalLine(value), width, TERMINAL_ELLIPSIS)
}
