// Fish parses eval arguments only at runtime. Mirror the static command-position
// scanner so an evaluated exec snapshots the environment before replacing Fish.
export const runtimeFishEvalRewriter = String.raw`
BEGIN { RS = sprintf("%c", 28) }
function closeEval() {
  while (wrapperCount > 0 && wrapperDepth[wrapperCount] == parenDepth) {
    printf " | string collect -N)"
    delete wrapperDepth[wrapperCount]
    wrapperCount--
  }
}
function wrapEval() {
  printf "eval (__ow_rewrite_eval"
  wrapperDepth[++wrapperCount] = parenDepth
  commandStart = 0
}
{
  code = $0
  quote = ""
  comment = 0
  commandStart = 1
  parenDepth = 0
  wrapperCount = 0
  for (i = 1; i <= length(code); ) {
    character = substr(code, i, 1)
    following = substr(code, i + 1, 1)
    if (comment) {
      printf "%s", character
      if (character == "\n") { comment = 0; commandStart = 1 }
      i++
      continue
    }
    if (quote != "") {
      printf "%s", character
      if (character == "\\" && following != "") { printf "%s", following; i += 2; continue }
      if (character == quote) quote = ""
      i++
      continue
    }
    if (character == "\\" && following == "\n") {
      printf "%s%s", character, following
      i += 2
      continue
    }
    if (character == "'" || character == "\"") {
      quote = character
      commandStart = 0
      printf "%s", character
      i++
      continue
    }
    if (character == ")" || character == "\n" || character ~ /[;|&<>]/) closeEval()
    if (character == "(") parenDepth++
    if (character == ")") parenDepth--
    if (character == "\n" || character ~ /[;|&()]/) {
      commandStart = 1
      printf "%s", character
      i++
      continue
    }
    if (character == "<" || character == ">") { printf "%s", character; i++; continue }
    if (character == "#" && (i == 1 || substr(code, i - 1, 1) ~ /[[:space:];|&()<>]/)) {
      closeEval()
      comment = 1
      printf "%s", character
      i++
      continue
    }
    if (character ~ /[[:space:]]/) { printf "%s", character; i++; continue }
    end = i
    while (end <= length(code) && substr(code, end, 1) !~ /[[:space:];|&()<>]/) end++
    word = substr(code, i, end - i)
    if (commandStart && word == "builtin") {
      nextStart = end
      while (substr(code, nextStart, 1) ~ /[ \t]/ && nextStart <= length(code)) nextStart++
      if (nextStart > end) {
        nextEnd = nextStart
        while (nextEnd <= length(code) && substr(code, nextEnd, 1) !~ /[[:space:];|&()<>]/) nextEnd++
        if (substr(code, nextStart, nextEnd - nextStart) == "eval") {
          wrapEval()
          i = nextEnd
          continue
        }
      }
    }
    if (commandStart && (word == "exec" || word == "\\exec")) printf "__ow_capture_exec"
    else if (commandStart && (word == "eval" || word == "\\eval")) {
      wrapEval()
      i = end
      continue
    } else printf "%s", word
    if (!(commandStart && word ~ /^(and|if|not|or|time|while)$/)) commandStart = 0
    i = end
  }
  while (wrapperCount > 0) {
    printf " | string collect -N)"
    wrapperCount--
  }
}`
