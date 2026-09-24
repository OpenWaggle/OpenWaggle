// eval reparses expanded text after the static scanner has run. Rewrite escaped
// exec tokens in that text so the exec alias captures exports made inside eval.
export const runtimeEvalRewriter = String.raw`
function keepsCommandPosition(word) {
  return word == "{" || word ~ /^[[:alpha:]_][[:alnum:]_]*=/ ||
    word ~ /^(\\?(command|builtin)|if|then|else|elif|do|while|until|time|!)$/
}
function redirectionOperatorLength(code, cursor,    triple, double, character) {
  triple = substr(code, cursor, 3)
  if (triple == "&>>" || triple == "<<<" || triple == "<<-") return 3
  double = substr(code, cursor, 2)
  if (double == "&>" || double == ">>" || double == ">|" || double == ">&" ||
      double == "<<" || double == "<&" || double == "<>") return 2
  character = substr(code, cursor, 1)
  return character == ">" || character == "<" ? 1 : 0
}
function isEvalCommandPosition(prefix,    cursor, character, following, quote, word, expected, depth, redirectionTarget, redirectLength) {
  quote = ""
  word = ""
  expected = 1
  redirectionTarget = 0
  depth = 0
  for (cursor = 1; cursor <= length(prefix); cursor++) {
    character = substr(prefix, cursor, 1)
    following = substr(prefix, cursor + 1, 1)
    if (quote != "") {
      word = word character
      if (character == quote) quote = ""
      else if (quote == "\"" && character == "\\" && following != "") {
        word = word following
        cursor++
      }
      continue
    }
    if (character == "\\" && following != "") {
      if (following == "\n") { cursor++; continue }
      word = word character following
      cursor++
      continue
    }
    if (character == "'" || character == "\"") {
      quote = character
      word = word character
      continue
    }
    if (character == " " || character == "\t") {
      if (word != "") {
        if (redirectionTarget) redirectionTarget = 0
        else expected = expected && keepsCommandPosition(word)
      }
      word = ""
      continue
    }
    redirectLength = redirectionOperatorLength(prefix, cursor)
    if (redirectLength > 0) {
      if (word != "") {
        if (redirectionTarget) redirectionTarget = 0
        else if (word !~ /^[0-9]+$/) expected = expected && keepsCommandPosition(word)
      }
      word = ""
      redirectionTarget = 1
      cursor += redirectLength - 1
      continue
    }
    if (character == "(") {
      depth++
      savedExpected[depth] = expected
      savedRedirectionTarget[depth] = redirectionTarget
      savedWord[depth] = word "("
      expected = 1
      redirectionTarget = 0
      word = ""
      continue
    }
    if (character == ")") {
      if (depth > 0) {
        if (savedWord[depth] == "(" && !savedRedirectionTarget[depth]) {
          expected = 1
          redirectionTarget = 0
          word = ""
        } else {
          expected = savedExpected[depth]
          redirectionTarget = savedRedirectionTarget[depth]
          word = savedWord[depth] ")"
        }
        depth--
      } else {
        # An unmatched ')' closes a case arm pattern and starts its command list.
        expected = 1
        redirectionTarget = 0
        word = ""
      }
      continue
    }
    if (character ~ /[;&|]/) {
      expected = 1
      redirectionTarget = 0
      word = ""
      continue
    }
    word = word character
  }
  return expected && word == "" && !redirectionTarget
}
function quotedBuiltinWordLength(code, start, name,    cursor, character, following, quote, word, quoted) {
  character = substr(code, start, 1)
  if (character != "e" && character != "\\" && character != "'" && character != "\"") return 0
  cursor = start
  quote = ""
  word = ""
  quoted = 0
  while (cursor <= length(code) && length(word) <= length(name)) {
    character = substr(code, cursor, 1)
    if (quote != "") {
      if (character == quote) quote = ""
      else if (quote == "\"" && character == "\\") return 0
      else word = word character
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
}
function heredocAt(code, start,    rest, prefix, body, quote, delimiter) {
  if (substr(code, start, 2) != "<<" || substr(code, start - 1, 1) == "<" ||
      substr(code, start, 3) == "<<<") return ""
  rest = substr(code, start)
  if (!match(rest, /^<<-?[ \t]*/)) return ""
  prefix = substr(rest, 1, RLENGTH)
  body = substr(rest, RLENGTH + 1)
  quote = substr(body, 1, 1)
  if (quote == "'" || quote == "\"") {
    body = substr(body, 2)
    if (!match(body, /^[[:alnum:]_-]+/)) return ""
    delimiter = substr(body, 1, RLENGTH)
    if (substr(body, RLENGTH + 1, 1) != quote) return ""
  } else {
    if (quote == "\\") body = substr(body, 2)
    if (!match(body, /^[[:alnum:]_-]+/)) return ""
    delimiter = substr(body, 1, RLENGTH)
  }
  pendingStripTabs = substr(prefix, 3, 1) == "-"
  return delimiter
}
BEGIN { RS = sprintf("%c", 28) }
{
  code = $0
  quote = ""
  comment = 0
  previous = ""
  heredoc = ""
  pendingHeredoc = ""
  lineStart = 1
  for (i = 1; i <= length(code); i++) {
    character = substr(code, i, 1)
    following = substr(code, i + 1, 1)
    if (quote == "single") {
      printf "%s", character
      if (character == "'") quote = ""
      previous = character
      continue
    }
    if (quote == "double") {
      printf "%s", character
      if (character == "\\" && following != "") { printf "%s", following; i++; previous = following; continue }
      if (character == "\"") quote = ""
      previous = character
      continue
    }
    if (character == "\n") {
      if (heredoc != "") {
        line = substr(code, lineStart, i - lineStart)
        if (stripTabs) sub(/^\t+/, "", line)
        if (line == heredoc) heredoc = ""
      }
      if (heredoc == "" && pendingHeredoc != "") {
        heredoc = pendingHeredoc
        stripTabs = pendingStripTabs
        pendingHeredoc = ""
      }
      lineStart = i + 1
      comment = 0
      printf "%s", character
      previous = character
      continue
    }
    if (heredoc != "") { printf "%s", character; previous = character; continue }
    if (comment) { printf "%s", character; previous = character; continue }
    evalLength = quotedBuiltinWordLength(code, i, "eval")
    execLength = quotedBuiltinWordLength(code, i, "exec")
    if ((evalLength > 0 || execLength > 0) &&
        isEvalCommandPosition(substr(code, lineStart, i - lineStart))) {
      replacement = evalLength > 0 ? "__ow_eval" : "exec"
      printf "%s", replacement
      i += (evalLength > 0 ? evalLength : execLength) - 1
      previous = substr(replacement, length(replacement), 1)
      continue
    }
    if (character == "'") quote = "single"
    else if (character == "\"") quote = "double"
    else if (character == "#" && (i == 1 || previous ~ /[[:space:];&|(){}]/)) comment = 1
    else if (character == "<" && following == "<") {
      delimiter = heredocAt(code, i)
      if (delimiter != "") pendingHeredoc = delimiter
    }
    else if (character == "\\" && (i == 1 || previous !~ /[[:alnum:]_\\]/)) {
      rest = substr(code, i + 1)
      if (rest ~ /^eval([^[:alnum:]_]|$)/ &&
          isEvalCommandPosition(substr(code, lineStart, i - lineStart))) {
        printf "__ow_"
        continue
      }
      if (rest ~ /^(command|builtin)[[:space:]]+exec([^[:alnum:]_]|$)/ ||
          rest ~ /^(command|builtin)[[:space:]]+\\exec([^[:alnum:]_]|$)/) continue
    }
    printf "%s", character
    if (character == "\\" && following != "") { printf "%s", following; i++; previous = following }
    else previous = character
  }
}`
