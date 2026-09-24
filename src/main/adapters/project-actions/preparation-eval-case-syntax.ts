// The eval rewriter must not confuse a case arm's ')' with a command-substitution closer.
export const runtimeEvalCaseSyntax = String.raw`
function caseWordAt(code, cursor, word,    before, after) {
  if (substr(code, cursor, length(word)) != word) return 0
  before = substr(code, cursor - 1, 1)
  after = substr(code, cursor + length(word), 1)
  return before !~ /[[:alnum:]_\\]/ && after !~ /[[:alnum:]_]/
}
function observeCaseSyntax(code, cursor, commandStart, substitutionDepth,    arm) {
  if (substitutionDepth == 0) return
  if (caseWordAt(code, cursor, "case") &&
      isEvalCommandPosition(substr(code, commandStart, cursor - commandStart))) {
    caseLevel++
    caseDepth[caseLevel] = substitutionDepth
    casePhase[caseLevel] = "subject"
    return
  }
  arm = caseLevel
  if (arm == 0 || caseDepth[arm] != substitutionDepth) return
  if (casePhase[arm] == "subject" && caseWordAt(code, cursor, "in")) {
    casePhase[arm] = "pattern"
    casePatternStart[arm] = cursor + 2
  } else if (caseWordAt(code, cursor, "esac") &&
      (casePhase[arm] == "pattern" ||
       isEvalCommandPosition(substr(code, commandStart, cursor - commandStart)))) {
    delete caseDepth[arm]
    delete casePhase[arm]
    delete casePatternStart[arm]
    caseLevel--
  } else if (casePhase[arm] == "body" &&
      (substr(code, cursor, 2) == ";;" || substr(code, cursor, 2) == ";&")) {
    casePhase[arm] = "pattern"
    casePatternStart[arm] = cursor + 2
  }
}
`
