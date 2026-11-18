// Parse command position in expanded eval text before rewriting escaped builtins.
export const runtimeEvalCommandPosition = String.raw`
function isEvalCommandPosition(prefix,    cursor, character, following, quote, word, expected, depth, redirectionTarget, redirectLength, prefixCommand, option, caseLevel, caseDepth, casePhase, optionalPattern) {
  if (prefix ~ /(^|[^[:alnum:]_])(function[[:space:]]+[[:alpha:]_][[:alnum:]_]*([(][)])?|[[:alpha:]_][[:alnum:]_]*[(][)])[[:space:]]*[{][[:space:]]*$/) return 1
  quote = ""
  word = ""
  expected = 1
  redirectionTarget = 0
  prefixCommand = ""
  depth = 0
  caseLevel = 0
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
    if (character == " " || character == "\t" || character == "\n") {
      if (word != "") {
        if (redirectionTarget) redirectionTarget = 0
        else {
          if (word == "case" && expected) {
            caseLevel++; caseDepth[caseLevel] = depth; casePhase[caseLevel] = "subject"
          } else if (caseLevel > 0 && caseDepth[caseLevel] == depth &&
                     casePhase[caseLevel] == "subject" && word == "in")
            casePhase[caseLevel] = "pattern"
          else if (caseLevel > 0 && caseDepth[caseLevel] == depth && word == "esac" &&
                   (casePhase[caseLevel] == "pattern" || expected)) caseLevel--
          option = supportedPrefixOption(prefixCommand, word)
          expected = expected && (option || keepsCommandPosition(word))
          if (option && word == "--") prefixCommand = prefixCommand "-end-options"
          else if (!option) prefixCommand = commandPrefix(word)
        }
      }
      word = ""
      if (character == "\n") { expected = 1; redirectionTarget = 0; prefixCommand = "" }
      continue
    }
    redirectLength = redirectionOperatorLength(prefix, cursor)
    if (redirectLength > 0) {
      if (word != "") {
        if (redirectionTarget) redirectionTarget = 0
        else if (word !~ /^[0-9]+$/) {
          option = supportedPrefixOption(prefixCommand, word)
          expected = expected && (option || keepsCommandPosition(word))
          if (option && word == "--") prefixCommand = prefixCommand "-end-options"
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
      optionalPattern = caseLevel > 0 && casePhase[caseLevel] == "pattern" &&
        depth == caseDepth[caseLevel] + 1 && savedWord[depth] == "("
      if (caseLevel > 0 && casePhase[caseLevel] == "pattern" &&
          (depth == caseDepth[caseLevel] || optionalPattern)) {
        if (optionalPattern) depth--
        casePhase[caseLevel] = "body"
        expected = 1; redirectionTarget = 0; prefixCommand = ""; word = ""
        continue
      }
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
      if (caseLevel > 0 && caseDepth[caseLevel] == depth &&
          casePhase[caseLevel] == "body" &&
          (substr(prefix, cursor, 2) == ";;" || substr(prefix, cursor, 2) == ";&"))
        casePhase[caseLevel] = "pattern"
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
`
