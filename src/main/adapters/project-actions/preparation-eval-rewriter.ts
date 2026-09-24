// eval reparses expanded text after the static scanner has run. Rewrite escaped
// exec tokens in that text so the exec alias captures exports made inside eval.
export const runtimeEvalRewriter = String.raw`
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
    if (character == "'") quote = "single"
    else if (character == "\"") quote = "double"
    else if (character == "#" && (i == 1 || previous ~ /[[:space:];&|(){}]/)) comment = 1
    else if (character == "<" && following == "<") {
      rest = substr(code, i)
      if (match(rest, /^<<-?[ \t]*[[:alnum:]_-]+/)) {
        pendingHeredoc = substr(rest, 1, RLENGTH)
        pendingStripTabs = substr(pendingHeredoc, 3, 1) == "-"
        sub(/^<<-?[ \t]*/, "", pendingHeredoc)
      }
    }
    else if (character == "\\" && (i == 1 || previous !~ /[[:alnum:]_\\]/)) {
      rest = substr(code, i + 1)
      prefix = substr(code, lineStart, i - lineStart)
      sub(/^.*[;&|({]/, "", prefix)
      if (rest ~ /^eval([^[:alnum:]_]|$)/ &&
          prefix ~ /^[ \t]*([[:alpha:]_][[:alnum:]_]*=[^ \t;&|(){}]+[ \t]+)*((\\?(command|builtin)|if|then|else|elif|do|while|until|time|!)[ \t]+)*$/) {
        printf "__ow_"
        continue
      }
      if (rest ~ /^exec([^[:alnum:]_]|$)/ ||
          rest ~ /^(command|builtin)[[:space:]]+exec([^[:alnum:]_]|$)/ ||
          rest ~ /^(command|builtin)[[:space:]]+\\exec([^[:alnum:]_]|$)/) continue
    }
    printf "%s", character
    if (character == "\\" && following != "") { printf "%s", following; i++; previous = following }
    else previous = character
  }
}`
