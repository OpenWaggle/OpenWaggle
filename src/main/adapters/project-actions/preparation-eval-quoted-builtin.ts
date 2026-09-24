// POSIX awk counterpart of preparation-quoted-builtin.ts, used inside dynamic eval text.
export const runtimeQuotedBuiltinWord = String.raw`
function ansiNumericCharacter(code, cursor,    rest, base, limit, offset, digit, position, value) {
  rest = substr(code, cursor + 1)
  base = 8
  limit = 3
  offset = 1
  if (substr(rest, 1, 1) == "x" || substr(rest, 1, 1) == "u" || substr(rest, 1, 1) == "U") {
    base = 16
    limit = substr(rest, 1, 1) == "x" ? 2 : (substr(rest, 1, 1) == "u" ? 4 : 8)
    offset = 2
  }
  value = 0
  for (ansiConsumed = offset; ansiConsumed < offset + limit; ansiConsumed++) {
    digit = substr(rest, ansiConsumed, 1)
    position = index(base == 8 ? "01234567" : "0123456789abcdef", tolower(digit))
    if (digit == "" || position == 0) break
    value = value * base + position - 1
  }
  if (ansiConsumed == offset || value > 127) return ""
  return sprintf("%c", value)
}
function quotedBuiltinWordLength(code, start, name,    cursor, character, following, quote, word, quoted, decoded) {
  character = substr(code, start, 1)
  if (character != "e" && character != "$" && character != "\\" && character != "'" && character != "\"") return 0
  cursor = start
  quote = ""
  word = ""
  quoted = 0
  while (cursor <= length(code) && length(word) <= length(name)) {
    character = substr(code, cursor, 1)
    if (quote == "ansi") {
      if (character == "'") quote = ""
      else if (character == "\\") {
        decoded = ansiNumericCharacter(code, cursor)
        if (decoded == "") return 0
        word = word decoded
        cursor += ansiConsumed - 1
      } else word = word character
    } else if (quote != "") {
      if (character == quote || (quote == "locale" && character == "\"")) quote = ""
      else if ((quote == "\"" || quote == "locale") && character == "\\") return 0
      else word = word character
    } else if (allowAnsi && character == "$" && substr(code, cursor + 1, 1) == "'") {
      quote = "ansi"
      quoted = 1
      cursor++
    } else if (allowLocale && character == "$" && substr(code, cursor + 1, 1) == "\"") {
      quote = "locale"
      quoted = 1
      cursor++
    } else if (character == "'" || character == "\"") {
      quote = character
      quoted = 1
    } else if (character == "\\") {
      following = substr(code, cursor + 1, 1)
      if (following == "" || following == "\n") return 0
      word = word following
      quoted = 1
      cursor++
    } else if (character ~ /[[:space:]]/ || index(";&|()<>{}", character) > 0) break
    else word = word character
    cursor++
  }
  return quote == "" && quoted && word == name ? cursor - start : 0
}`
