import type { ILink, ILinkHandler, ILinkProvider } from '@xterm/xterm'
import type {
  TerminalBufferLineLike,
  TerminalLinkActivationTarget,
  TerminalLinkResolutionContext,
} from './terminal-link-types'
import {
  collectWrappedTerminalLinkLine,
  extractTerminalLinkMatches,
  isTerminalLinkActivation,
  resolveTerminalOsc8Target,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from './terminal-links'

export type ActivateTerminalLink = (target: TerminalLinkActivationTarget) => void

interface TerminalLinkBuffer {
  readonly active: {
    getLine(index: number): TerminalBufferLineLike | undefined
  }
}

interface TerminalLinkProviderOptions {
  readonly buffer: TerminalLinkBuffer
  readonly context: TerminalLinkResolutionContext
  readonly platform: string
  readonly onActivate: ActivateTerminalLink
}

/**
 * Creates the plain-text provider without taking ownership of xterm. Keeping
 * this pure makes wrapped-line and modifier behavior independently testable.
 */
export function createTerminalLinkProvider(options: TerminalLinkProviderOptions): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const logicalLine = collectWrappedTerminalLinkLine(bufferLineNumber, (index) =>
        options.buffer.active.getLine(index),
      )
      if (logicalLine === null) {
        callback(undefined)
        return
      }

      const links: ILink[] = []
      for (const match of extractTerminalLinkMatches(logicalLine.text, options.context)) {
        const range = resolveWrappedTerminalLinkRange(logicalLine, match)
        if (!wrappedTerminalLinkRangeIntersectsBufferLine(range, bufferLineNumber)) continue
        links.push({
          text: match.text,
          range,
          decorations: { pointerCursor: true, underline: true },
          activate(event) {
            if (isTerminalLinkActivation(event, options.platform)) {
              options.onActivate(match.target)
            }
          },
        })
      }
      callback(links.length > 0 ? links : undefined)
    },
  }
}

/** Safe OSC 8 handler. Non-HTTP protocols reach it only so validated file: URIs can work. */
export function createTerminalOsc8LinkHandler(
  context: TerminalLinkResolutionContext,
  platform: string,
  onActivate: ActivateTerminalLink,
): ILinkHandler {
  return {
    allowNonHttpProtocols: true,
    activate(event, uri) {
      if (!isTerminalLinkActivation(event, platform)) return
      const target = resolveTerminalOsc8Target(uri, context)
      if (target !== null) onActivate(target)
    },
  }
}
