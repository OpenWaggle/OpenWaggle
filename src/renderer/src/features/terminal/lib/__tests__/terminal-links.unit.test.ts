import { describe, expect, it } from 'vitest'
import {
  collectWrappedTerminalLinkLine,
  extractTerminalLinkMatches,
  parseTerminalFileReference,
  resolveTerminalOsc8Target,
  resolveWrappedTerminalLinkRange,
  type TerminalBufferCellLike,
  type TerminalBufferLineLike,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from '../terminal-links'

const UNIX_CONTEXT = {
  cwd: '/Users/alice/project/packages/app',
  projectRoot: '/Users/alice/project',
  homePath: '/Users/alice',
}

const WINDOWS_CONTEXT = {
  cwd: 'C:\\Users\\Alice\\repo\\packages\\app',
  projectRoot: 'c:\\users\\alice\\repo',
  homePath: 'C:\\Users\\Alice',
}

describe('extractTerminalLinkMatches', () => {
  it.each([
    {
      name: 'HTTP URL with balanced punctuation',
      line: 'Read (https://example.com/a_(b)).',
      context: UNIX_CONTEXT,
      expectedText: 'https://example.com/a_(b)',
      expectedTarget: {
        kind: 'url',
        source: 'plain',
        url: 'https://example.com/a_(b)',
        route: 'url-preview',
      },
    },
    {
      name: 'Unicode relative path with colon position',
      line: 'at src/组件/终端.ts:42:7.',
      context: UNIX_CONTEXT,
      expectedText: 'src/组件/终端.ts:42:7',
      expectedTarget: {
        kind: 'file',
        resolvedPath: '/Users/alice/project/packages/app/src/组件/终端.ts',
        line: 42,
        column: 7,
        projectRelativePath: 'packages/app/src/组件/终端.ts',
        route: 'workspace-preview',
        resolution: 'cwd-relative',
      },
    },
    {
      name: 'bare relative file with parenthesized position',
      line: 'main.test.ts(18,6)',
      context: UNIX_CONTEXT,
      expectedText: 'main.test.ts(18,6)',
      expectedTarget: {
        kind: 'file',
        resolvedPath: '/Users/alice/project/packages/app/main.test.ts',
        line: 18,
        column: 6,
        projectRelativePath: 'packages/app/main.test.ts',
        route: 'workspace-preview',
        resolution: 'cwd-relative',
      },
    },
    {
      name: 'absolute path with parenthesized position',
      line: 'failed in /Users/alice/project/src/main.ts(12,3), retrying',
      context: UNIX_CONTEXT,
      expectedText: '/Users/alice/project/src/main.ts(12,3)',
      expectedTarget: {
        kind: 'file',
        resolvedPath: '/Users/alice/project/src/main.ts',
        line: 12,
        column: 3,
        projectRelativePath: 'src/main.ts',
        route: 'workspace-preview',
        resolution: 'absolute',
      },
    },
    {
      name: 'tilde path',
      line: 'config: ~/.config/openwaggle/settings.json:8',
      context: UNIX_CONTEXT,
      expectedText: '~/.config/openwaggle/settings.json:8',
      expectedTarget: {
        kind: 'file',
        resolvedPath: '/Users/alice/.config/openwaggle/settings.json',
        line: 8,
        column: null,
        projectRelativePath: null,
        route: 'external-editor',
        resolution: 'home-relative',
      },
    },
    {
      name: 'Windows path and case-insensitive project root',
      line: 'C:\\Users\\Alice\\repo\\src\\main.ts:9:2',
      context: WINDOWS_CONTEXT,
      expectedText: 'C:\\Users\\Alice\\repo\\src\\main.ts:9:2',
      expectedTarget: {
        kind: 'file',
        resolvedPath: 'C:\\Users\\Alice\\repo\\src\\main.ts',
        line: 9,
        column: 2,
        projectRelativePath: 'src/main.ts',
        route: 'workspace-preview',
        resolution: 'absolute',
      },
    },
    {
      name: 'Windows relative path with parent traversal',
      line: '..\\shared\\worker.ts(4,2)',
      context: WINDOWS_CONTEXT,
      expectedText: '..\\shared\\worker.ts(4,2)',
      expectedTarget: {
        kind: 'file',
        resolvedPath: 'C:\\Users\\Alice\\repo\\packages\\shared\\worker.ts',
        line: 4,
        column: 2,
        projectRelativePath: 'packages/shared/worker.ts',
        route: 'workspace-preview',
        resolution: 'cwd-relative',
      },
    },
  ])('finds $name', ({ line, context, expectedText, expectedTarget }) => {
    const matches = extractTerminalLinkMatches(line, context)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      text: expectedText,
      start: line.indexOf(expectedText),
      end: line.indexOf(expectedText) + expectedText.length,
      target: expectedTarget,
    })
  })

  it('routes paths outside the project to an editor without rejecting them', () => {
    const [outside, escaped] = extractTerminalLinkMatches(
      '/opt/tool/config.ts:5 ../../../../etc/hosts:2',
      UNIX_CONTEXT,
    )

    expect(outside?.target).toMatchObject({
      kind: 'file',
      resolvedPath: '/opt/tool/config.ts',
      projectRelativePath: null,
      route: 'external-editor',
    })
    expect(escaped?.target).toMatchObject({
      kind: 'file',
      resolvedPath: '/Users/etc/hosts',
      projectRelativePath: null,
      route: 'external-editor',
    })
  })

  it.each([
    'javascript:alert/src/main.ts',
    'data://text/plain/src/main.ts',
    'ssh://git.example.com/org/repo',
    'ratio 1/2 and version 1.2.3',
    'service at 127.0.0.1:3000',
    'plain words with no path',
  ])('does not turn unsafe schemes or prose into links: %s', (line) => {
    expect(extractTerminalLinkMatches(line, UNIX_CONTEXT)).toEqual([])
  })

  it('keeps URL matches whole instead of also emitting their path fragments', () => {
    const matches = extractTerminalLinkMatches(
      'https://example.com/src/main.ts:12?next=docs/setup.md',
      UNIX_CONTEXT,
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]?.target.kind).toBe('url')
  })
})

describe('parseTerminalFileReference', () => {
  it.each([
    ['src/main.ts:12', { path: 'src/main.ts', line: 12, column: null }],
    ['src/main.ts:12:4', { path: 'src/main.ts', line: 12, column: 4 }],
    ['src/main.ts(12,4)', { path: 'src/main.ts', line: 12, column: 4 }],
    ['C:\\repo\\src\\main.ts:12:4', { path: 'C:\\repo\\src\\main.ts', line: 12, column: 4 }],
  ])('parses %s', (input, expected) => {
    expect(parseTerminalFileReference(input)).toEqual(expected)
  })

  it.each(['javascript:src/main.ts', 'src/main.ts:0', 'src/main.ts(4,0)', './'])(
    'rejects malformed or unsafe reference %s',
    (input) => {
      expect(parseTerminalFileReference(input)).toBeNull()
    },
  )
})

describe('resolveTerminalOsc8Target', () => {
  it('accepts safe web hyperlinks from xterm OSC 8 handling', () => {
    expect(resolveTerminalOsc8Target('HTTPS://example.com/docs?q=terminal', UNIX_CONTEXT)).toEqual({
      kind: 'url',
      source: 'osc8',
      url: 'https://example.com/docs?q=terminal',
      route: 'url-preview',
    })
  })

  it('decodes local file hyperlinks and keeps their source position', () => {
    expect(
      resolveTerminalOsc8Target('file:///Users/alice/project/src/a%20b.ts:5:2', UNIX_CONTEXT),
    ).toEqual({
      kind: 'file',
      source: 'osc8',
      rawPath: '/Users/alice/project/src/a b.ts',
      resolvedPath: '/Users/alice/project/src/a b.ts',
      line: 5,
      column: 2,
      projectRelativePath: 'src/a b.ts',
      route: 'workspace-preview',
      resolution: 'absolute',
    })
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'vscode://file/Users/alice/project/main.ts',
    'https://user:secret@example.com/private',
    'file:///tmp/a.ts?command=run',
  ])('rejects unsafe OSC 8 target %s', (uri) => {
    expect(resolveTerminalOsc8Target(uri, UNIX_CONTEXT)).toBeNull()
  })
})

function createBufferLine(text: string, isWrapped = false): TerminalBufferLineLike {
  return {
    isWrapped,
    translateToString: (trimRight = false) => (trimRight ? text.trimEnd() : text),
  }
}

function createCell(chars: string, width: number): TerminalBufferCellLike {
  return { getChars: () => chars, getWidth: () => width }
}

describe('wrapped terminal links', () => {
  it('reconstructs a URL split over physical terminal rows', () => {
    const first = 'see https://example.'
    const second = 'com/reference'
    const lines = [createBufferLine(first), createBufferLine(second, true)]
    const logicalLine = collectWrappedTerminalLinkLine(2, (index) => lines[index])

    expect(logicalLine?.text).toBe(`${first}${second}`)
    if (logicalLine === null) throw new Error('Expected a wrapped logical line.')
    const [match] = extractTerminalLinkMatches(logicalLine.text, UNIX_CONTEXT)
    if (match === undefined) throw new Error('Expected a link match.')
    const range = resolveWrappedTerminalLinkRange(logicalLine, match)
    expect(range).toEqual({
      start: { x: 5, y: 1 },
      end: { x: second.length, y: 2 },
    })
    expect(wrappedTerminalLinkRangeIntersectsBufferLine(range, 1)).toBe(true)
    expect(wrappedTerminalLinkRangeIntersectsBufferLine(range, 2)).toBe(true)
    expect(wrappedTerminalLinkRangeIntersectsBufferLine(range, 3)).toBe(false)
  })

  it('maps UTF-16 indices back to xterm cells after a wide emoji', () => {
    const cells = [
      createCell('🙂', 2),
      createCell('', 0),
      createCell(' ', 1),
      ...Array.from('src/组件/main.ts:4', (character) => createCell(character, 1)),
    ]
    const text = '🙂 src/组件/main.ts:4'
    const line: TerminalBufferLineLike = {
      isWrapped: false,
      length: cells.length,
      getCell: (column) => cells[column],
      translateToString: () => text,
    }
    const logicalLine = collectWrappedTerminalLinkLine(1, () => line)
    if (logicalLine === null) throw new Error('Expected a logical line.')
    const [match] = extractTerminalLinkMatches(logicalLine.text, UNIX_CONTEXT)
    if (match === undefined) throw new Error('Expected a path match.')

    expect(resolveWrappedTerminalLinkRange(logicalLine, match).start).toEqual({ x: 4, y: 1 })
  })
})
