/** The streamed answer of the streaming measurement: markdown with lists, links, tables and code. */
const ITEMS = 40
const CODE_EVERY = 8
const CODE_LINES = 12
const TOKEN_CHARACTERS = 4

export function streamedAnswerTokens(tokenCount: number) {
  const parts: string[] = ['## Analysis\n\nHere is a long answer with **bold**, `inline code`, lists and fenced code.\n\n']
  for (let item = 0; item < ITEMS; item += 1) {
    parts.push(`- Item ${String(item)}: the quick brown fox jumps over the lazy dog, see [link ${String(item)}](https://example.com/${String(item)}).\n`)
    if (item % CODE_EVERY === CODE_EVERY - 1) {
      parts.push('\n```ts\n')
      for (let line = 0; line < CODE_LINES; line += 1) {
        parts.push(`export function f${String(item)}_${String(line)}(value: number): number {\n  return value * ${String(line)} + ${String(item)} // comment\n}\n`)
      }
      parts.push('```\n\n| Col A | Col B | Col C |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n\n')
    }
  }
  const text = parts.join('')
  const tokens: string[] = []
  for (let index = 0; index < text.length && tokens.length < tokenCount; index += TOKEN_CHARACTERS) {
    tokens.push(text.slice(index, index + TOKEN_CHARACTERS))
  }
  return tokens
}
