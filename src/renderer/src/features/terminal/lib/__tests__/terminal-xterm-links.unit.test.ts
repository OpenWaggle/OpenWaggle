// @vitest-environment jsdom

import { fromPartial } from '@total-typescript/shoehorn'
import type { ILink } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalBufferLineLike } from '../terminal-links'
import { createTerminalLinkProvider, createTerminalOsc8LinkHandler } from '../terminal-xterm-links'

const CONTEXT = {
  cwd: '/Users/alice/project/packages/app',
  projectRoot: '/Users/alice/project',
  homePath: '/Users/alice',
}

function line(text: string, isWrapped = false): TerminalBufferLineLike {
  return {
    isWrapped,
    translateToString: (trimRight = false) => (trimRight ? text.trimEnd() : text),
  }
}

function linksFor(
  provider: ReturnType<typeof createTerminalLinkProvider>,
  bufferLineNumber: number,
) {
  let links: ILink[] | undefined
  provider.provideLinks(bufferLineNumber, (provided) => {
    links = provided
  })
  return links
}

describe('createTerminalLinkProvider', () => {
  it('maps wrapped links to xterm buffer ranges and activates only with the native modifier', () => {
    const lines = [line('see https://example.'), line('com/docs', true)]
    const onActivate = vi.fn()
    const provider = createTerminalLinkProvider({
      buffer: { active: { getLine: (index) => lines[index] } },
      context: CONTEXT,
      platform: 'MacIntel',
      onActivate,
    })

    const firstRowLinks = linksFor(provider, 1)
    const secondRowLinks = linksFor(provider, 2)
    expect(firstRowLinks).toHaveLength(1)
    expect(secondRowLinks).toHaveLength(1)
    expect(firstRowLinks?.[0]?.range).toEqual({
      start: { x: 5, y: 1 },
      end: { x: 8, y: 2 },
    })

    firstRowLinks?.[0]?.activate(fromPartial<MouseEvent>({ metaKey: false, ctrlKey: false }), '')
    expect(onActivate).not.toHaveBeenCalled()

    firstRowLinks?.[0]?.activate(fromPartial<MouseEvent>({ metaKey: true, ctrlKey: false }), '')
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'url', url: 'https://example.com/docs' }),
    )
  })

  it('returns no links for prose and unsafe schemes', () => {
    const lines = [line('javascript:alert/src/main.ts and plain prose')]
    const provider = createTerminalLinkProvider({
      buffer: { active: { getLine: (index) => lines[index] } },
      context: CONTEXT,
      platform: 'Linux x86_64',
      onActivate: vi.fn(),
    })

    expect(linksFor(provider, 1)).toBeUndefined()
  })
})

describe('createTerminalOsc8LinkHandler', () => {
  it('routes validated file links and rejects unsafe protocols', () => {
    const onActivate = vi.fn()
    const handler = createTerminalOsc8LinkHandler(CONTEXT, 'Win32', onActivate)
    const ctrlClick = fromPartial<MouseEvent>({ metaKey: false, ctrlKey: true })

    handler.activate(ctrlClick, 'file:///Users/alice/project/src/main.ts:7', {
      start: { x: 1, y: 1 },
      end: { x: 2, y: 1 },
    })
    handler.activate(ctrlClick, 'javascript:alert(1)', {
      start: { x: 1, y: 1 },
      end: { x: 2, y: 1 },
    })

    expect(onActivate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'file',
        projectRelativePath: 'src/main.ts',
        line: 7,
      }),
    )
  })
})
