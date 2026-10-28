import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it, vi } from 'vitest'
import { remarkStreamingListTail, splitListTail } from '../streaming-list-tail'

const whole = unified().use(remarkParse).use(remarkGfm)
const bounded = unified().use(remarkParse).use(remarkGfm).use(remarkStreamingListTail)

const LISTS = [
  Array.from(
    { length: 12 },
    (_, index) =>
      `- Item ${String(index)}: the **quick** fox, see [link ${String(index)}](https://example.com/${String(index)}) and \`code\`.\n`,
  ).join(''),
  '1. First step\n2. Second step with *emphasis*\n   continued on an indented line\n3. Third\n   - nested bullet\n   - another\n10. Tenth\n',
  '* [ ] open task\n* [x] done task\n* plain item with https://example.com/autolink\n',
  '- a\n- b\n* switched marker\n- back\n',
  '- a\nlazy continuation\n- b\n',
  '- a\n- - -\n- b\n',
  '- a\n- b [ref][r]\n\n[r]: https://example.com\n',
  '- a\n  ```ts\n  const x = 1\n  ```\n- b\n',
  '1) paren\n2) style\n3. dot\n',
]

describe('remarkStreamingListTail', () => {
  it('parses every streamed prefix of a list to exactly the tree of a whole parse', () => {
    for (const list of LISTS) {
      for (let end = 0; end <= list.length; end += 1) {
        const text = list.slice(0, end)
        expect(bounded.parse(text), JSON.stringify(text)).toEqual(whole.parse(text))
      }
    }
  })

  it('parses the finished items once while the last one streams', () => {
    const items = LISTS[0] ?? ''
    const parse = vi.fn(whole.parser ?? (() => ({ type: 'root' })))
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(function spy() {
        const parser = this.parser
        if (parser)
          this.parser = (document, file) => {
            parse(document, file)
            return parser(document, file)
          }
      })
      .use(remarkStreamingListTail)
    const tokens = ['- Last item', ' grows', ' word', ' by word']
    let text = items
    for (const token of tokens) {
      text += token
      processor.parse(text)
    }
    const parsedDocuments = parse.mock.calls.map(([document]) => document ?? '')
    // The twelve finished items are parsed once; each token parses only the last item.
    expect(parsedDocuments.filter((document) => document === items)).toHaveLength(1)
    expect(parsedDocuments.filter((document) => document.length > items.length)).toHaveLength(0)
  })

  it('keeps the cached items intact through the whole pipeline to HTML', async () => {
    const remarkRehype = (await import('remark-rehype')).default
    const rehypeSanitize = (await import('rehype-sanitize')).default
    const pipeline = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkStreamingListTail)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeSanitize)
    const list = LISTS[0] ?? ''
    for (let end = list.length - 40; end <= list.length; end += 1) {
      pipeline.runSync(pipeline.parse(list.slice(0, end)))
    }
    // The shared items were not written to: a later parse still equals a whole parse.
    expect(bounded.parse(list)).toEqual(whole.parse(list))
  })

  it('leaves text that is not a plain streaming list to a whole parse', () => {
    expect(splitListTail('- only one item')).toBeNull()
    expect(splitListTail('Paragraph\n- a\n- b')).toBeNull()
    expect(splitListTail('- a\n\n- b')).toBeNull()
    expect(splitListTail('- a\n- b')).toEqual({ head: '- a\n', last: '- b' })
  })
})
