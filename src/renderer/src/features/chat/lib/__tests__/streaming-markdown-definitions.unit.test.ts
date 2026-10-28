import { describe, expect, it } from 'vitest'
import { splitStreamingMarkdown } from '../streaming-markdown-blocks'
import { withReferenceDefinitions } from '../streaming-markdown-definitions'

function blockTexts(text: string) {
  return splitStreamingMarkdown(text).blocks.map((block) => block.text)
}

/*
 * Review V1 P3-4: any definition-like line, one in a fenced example included, made the whole answer
 * the live tail, re-parsed on every token, and a long open fence after it lost its unparsed path.
 */
describe('streaming Markdown with reference definitions', () => {
  it('keeps the split for plain reference definitions, and lists them for every block', () => {
    const text = '[OpenWaggle][docs]\n\nParagraph\n\n[docs]: https://openwaggle.dev\n\nTail'
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [
        { start: 0, text: '[OpenWaggle][docs]\n\n' },
        { start: 20, text: 'Paragraph\n\n' },
        { start: 31, text: '[docs]: https://openwaggle.dev\n\n' },
      ],
      tail: { kind: 'markdown', start: 63, text: 'Tail' },
      definitions: '[docs]: https://openwaggle.dev',
    })
    // A block is parsed with the definitions it mentions, and only those.
    expect(
      withReferenceDefinitions('[OpenWaggle][DOCS]\n\n', '[docs]: https://openwaggle.dev'),
    ).toBe('[docs]: https://openwaggle.dev\n\n[OpenWaggle][DOCS]\n\n')
    expect(withReferenceDefinitions('Paragraph\n\n', '[docs]: https://openwaggle.dev')).toBe(
      'Paragraph\n\n',
    )
    // Still streaming, the definition resolves the reference in the block above it.
    expect(splitStreamingMarkdown('[OpenWaggle][docs]\n\n[docs]: https://open').definitions).toBe(
      '[docs]: https://open',
    )
  })

  it('reads text holding any other definition as one document, its tail included', () => {
    const footnote = 'A claim.[^1]\n\n[^1]: The source.'
    expect(splitStreamingMarkdown(footnote)).toEqual({
      blocks: [],
      tail: { kind: 'markdown', start: 0, text: footnote },
      definitions: '',
    })
    expect(blockTexts('Intro\n\n> - [x]: https://example.com\n\nTail')).toEqual([])
    // A definition line in a paragraph is its text, and one over two lines is not plain.
    expect(blockTexts('Intro\n[x]: https://example.com\n\nTail')).toEqual([])
    expect(blockTexts('Intro\n\n[x]:\n  https://example.com\n\nTail')).toEqual([])
  })

  it('never reads a definition-like line in fenced code as a definition (review V1 P3-4)', () => {
    const text = '```md\n[x]: y\n```\n\nPara one\n\nPara two\n\nTail'
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [
        { start: 0, text: '```md\n[x]: y\n```\n' },
        { start: 17, text: '\nPara one\n\n' },
        { start: 28, text: 'Para two\n\n' },
      ],
      tail: { kind: 'markdown', start: 38, text: 'Tail' },
      definitions: '',
    })
    expect(blockTexts('<!--\n\n[x]: y\n\n-->\n\nAfter')).toEqual(['<!--\n\n[x]: y\n\n-->\n\n'])
  })

  it('keeps an open fence after a definition unparsed as the tail (review V1 P3-4)', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${String(index)}`)
    const text = `See [the docs].\n\n[the docs]: https://openwaggle.dev\n\n\`\`\`ts\n${lines.join('\n')}`
    const { blocks, tail, definitions } = splitStreamingMarkdown(text)
    expect(blocks.map((block) => block.text)).toEqual([
      'See [the docs].\n\n',
      '[the docs]: https://openwaggle.dev\n\n',
    ])
    expect(tail).toEqual({
      kind: 'open-fence',
      start: text.indexOf('```'),
      language: 'ts',
      code: lines.join('\n'),
    })
    expect(definitions).toBe('[the docs]: https://openwaggle.dev')
  })
})
