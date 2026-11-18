/**
 * The number of Unicode code points in `text`, not UTF-16 units or graphemes. A key event's
 * printable `key` is one code point, and the Host's trigram search index counts code points.
 */
export function codePointLength(text: string) {
  let length = 0
  for (const _codePoint of text) length += 1
  return length
}
