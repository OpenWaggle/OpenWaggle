// eval reparses expanded text after the static scanner has run. Rewrite escaped
// exec tokens in that text so the exec alias captures exports made inside eval.
export const runtimeEvalRewriter = String.raw`
function keepsCommandPosition(word) {
  return word == "{" || word ~ /^[[:alpha:]_][[:alnum:]_]*=/ ||
    word ~ /^(\\?(command|builtin)|if|then|else|elif|do|while|until|time|!)$/
}
function commandPrefix(word) {
  if (word == "command" || word == "\\command") return "command"
  return word == "time" ? "time" : ""
}
function supportedPrefixOption(prefix, word) {
  return (prefix == "command" && (word == "--" || word == "-p")) ||
    (prefix == "time" && word == "-p")
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
function isEvalCommandPosition(prefix,    cursor, character, following, quote, word, expected, depth, redirectionTarget, redirectLength, prefixCommand, option) {
  quote = ""
  word = ""
  expected = 1
  redirectionTarget = 0
  prefixCommand = ""
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
        else {
          option = supportedPrefixOption(prefixCommand, word)
          expected = expected && (option || keepsCommandPosition(word))
          if (option && word == "--") prefixCommand = "command-end-options"
          else if (!option) prefixCommand = commandPrefix(word)
        }
      }
      word = ""
      continue
    }
    redirectLength = redirectionOperatorLength(prefix, cursor)
    if (redirectLength > 0) {
      if (word != "") {
        if (redirectionTarget) redirectionTarget = 0
        else if (word !~ /^[0-9]+$/) {
          option = supportedPrefixOption(prefixCommand, word)
          expected = expected && (option || keepsCommandPosition(word))
          if (option && word == "--") prefixCommand = "command-end-options"
          else if (!option) prefixCommand = commandPrefix(word)
        }
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
      savedPrefixCommand[depth] = prefixCommand
      expected = 1
      redirectionTarget = 0
      prefixCommand = ""
      word = ""
      continue
    }
    if (character == ")") {
      if (depth > 0) {
        if (savedWord[depth] == "(" && !savedRedirectionTarget[depth]) {
          expected = 1
          redirectionTarget = 0
          prefixCommand = ""
          word = ""
        } else {
          expected = savedExpected[depth]
          redirectionTarget = savedRedirectionTarget[depth]
          prefixCommand = savedPrefixCommand[depth]
          word = savedWord[depth] ")"
        }
        depth--
      } else {
        # An unmatched ')' closes a case arm pattern and starts its command list.
        expected = 1
        redirectionTarget = 0
        prefixCommand = ""
        word = ""
      }
      continue
    }
    if (character ~ /[;&|]/) {
      expected = 1
      redirectionTarget = 0
      prefixCommand = ""
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
function heredocAt(code, start,    rest, prefix, cursor, character, following, quote, delimiter, sawWord) {
  foundHeredoc = 0
  if (substr(code, start, 2) != "<<" || substr(code, start - 1, 1) == "<" ||
      substr(code, start, 3) == "<<<") return ""
  rest = substr(code, start)
  if (!match(rest, /^<<-?[ \t]*/)) return ""
  prefix = substr(rest, 1, RLENGTH)
  cursor = RLENGTH + 1
  quote = ""
  delimiter = ""
  sawWord = 0
  for (; cursor <= length(rest); cursor++) {
    character = substr(rest, cursor, 1)
    following = substr(rest, cursor + 1, 1)
    if (quote == "'") {
      if (character == "'") quote = ""
      else delimiter = delimiter character
      continue
    }
    if (quote == "\"") {
      if (character == "\"") quote = ""
      else if (character == "\\" && following != "" &&
          (following == "$" || following == "\"" || following == "\\" ||
           following == sprintf("%c", 96) || following == "\n")) {
        if (following != "\n") delimiter = delimiter following
        cursor++
      } else delimiter = delimiter character
      continue
    }
    if (character ~ /[[:space:];&|<>()]/) break
    sawWord = 1
    if (character == "'" || character == "\"") quote = character
    else if (character == "\\" && following != "") {
      if (following != "\n") delimiter = delimiter following
      cursor++
    } else delimiter = delimiter character
  }
  if (!sawWord || quote != "") return ""
  pendingStripTabs = substr(prefix, 3, 1) == "-"
  foundHeredoc = 1
  return delimiter
}
BEGIN { RS = sprintf("%c", 28) }
{
  code = $0
  quote = ""
  comment = 0
  previous = ""
  arithmeticDepth = 0
  heredoc = ""
  heredocActive = 0
  pendingCount = 0
  pendingHead = 1
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
      if (heredocActive) {
        line = substr(code, lineStart, i - lineStart)
        if (stripTabs) sub(/^\t+/, "", line)
        if (line == heredoc) heredocActive = 0
      }
      if (!heredocActive && pendingHead <= pendingCount) {
        heredoc = pendingDelimiters[pendingHead]
        stripTabs = pendingTabs[pendingHead]
        heredocActive = 1
        pendingHead++
      }
      lineStart = i + 1
      comment = 0
      printf "%s", character
      previous = character
      continue
    }
    if (heredocActive) { printf "%s", character; previous = character; continue }
    if (comment) { printf "%s", character; previous = character; continue }
    if (arithmeticDepth > 0) {
      printf "%s", character
      if (character == "\\" && following != "") {
        printf "%s", following; i++; previous = following; continue
      }
      if (character == "(") arithmeticDepth++
      else if (character == ")") arithmeticDepth--
      previous = character
      continue
    }
    if (substr(code, i, 3) == "$((") {
      arithmeticDepth = 2
      printf "$(("
      i += 2
      previous = "("
      continue
    }
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
      if (foundHeredoc) {
        pendingCount++
        pendingDelimiters[pendingCount] = delimiter
        pendingTabs[pendingCount] = pendingStripTabs
      }
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
