import { runtimeEvalCaseSyntax } from './preparation-eval-case-syntax'
import { runtimeEvalCommandPosition } from './preparation-eval-command-position'
import { runtimeQuotedBuiltinWord } from './preparation-eval-quoted-builtin'

// eval reparses expanded text after the static scanner has run. Rewrite escaped
// exec tokens in that text so the exec alias captures exports made inside eval.
export const runtimeEvalRewriter = String.raw`
function keepsCommandPosition(word) {
  return word == "{" || word ~ /^[[:alpha:]_][[:alnum:]_]*=/ ||
    word ~ /^(\\?(command|builtin)|if|then|else|elif|do|while|until|time|!)$/
}
function commandPrefix(word) {
  if (word == "command" || word == "\\command") return "command"
  if (word == "builtin" || word == "\\builtin") return "builtin"
  return word == "time" ? "time" : ""
}
function supportedPrefixOption(prefix, word) {
  return (prefix == "command" && (word == "--" || word == "-p")) ||
    (prefix == "builtin" && word == "--") ||
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
${runtimeEvalCommandPosition}
${runtimeEvalCaseSyntax}
${runtimeQuotedBuiltinWord}
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
  commandStart = 1
  substitutionDepth = 0
  for (depth in substitutionStart) delete substitutionStart[depth]
  caseLevel = 0
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
      commandStart = i + 1
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
    if (substr(code, i, 3) == "$((" || substr(code, i, 2) == "((") {
      arithmeticDepth = 2; previous = "("; expansion = substr(code, i, 3) == "$(("
      printf "%s", expansion ? "$((" : "(("
      i += expansion ? 2 : 1
      continue
    }
    if ((character == "$" || character == "<" || character == ">") && following == "(") {
      substitutionDepth++
      substitutionStart[substitutionDepth] = commandStart
      printf "%s(", character
      i++
      previous = "("
      continue
    }
    observeCaseSyntax(code, i, commandStart, substitutionDepth)
    evalLength = quotedBuiltinWordLength(code, i, "eval")
    execLength = quotedBuiltinWordLength(code, i, "exec")
    if ((evalLength > 0 || execLength > 0) &&
        isEvalCommandPosition(substr(code, commandStart, i - commandStart))) {
      replacement = evalLength > 0 ? "__ow_eval" : "exec"
      printf "%s", replacement
      i += (evalLength > 0 ? evalLength : execLength) - 1
      previous = substr(replacement, length(replacement), 1)
      continue
    }
    if (character == "(" && substitutionDepth > 0) {
      if (caseLevel == 0 || caseDepth[caseLevel] != substitutionDepth ||
          casePhase[caseLevel] != "pattern" ||
          substr(code, casePatternStart[caseLevel], i - casePatternStart[caseLevel]) !~ /^[[:space:]]*$/)
        substitutionDepth++
    }
    else if (character == ")" && substitutionDepth > 0) {
      if (caseLevel > 0 && caseDepth[caseLevel] == substitutionDepth &&
          casePhase[caseLevel] == "pattern") {
        casePhase[caseLevel] = "body"
        printf ")"
        previous = ")"
        continue
      }
      if (substitutionStart[substitutionDepth]) {
        commandStart = substitutionStart[substitutionDepth]
        delete substitutionStart[substitutionDepth]
      }
      substitutionDepth--
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
          isEvalCommandPosition(substr(code, commandStart, i - commandStart))) {
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
