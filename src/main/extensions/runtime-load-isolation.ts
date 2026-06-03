export interface RuntimeLoadSelection {
  readonly packagePath: string
}

interface LoadAttemptSuccess<Result> {
  readonly ok: true
  readonly result: Result
}

interface LoadAttemptFailure {
  readonly ok: false
  readonly error: unknown
}

type LoadAttemptResult<Result> = LoadAttemptSuccess<Result> | LoadAttemptFailure

function packagePaths(selections: readonly RuntimeLoadSelection[]) {
  return selections.map((selection) => selection.packagePath)
}

async function captureLoadResult<Result>(
  selections: readonly RuntimeLoadSelection[],
  load: (packagePaths: readonly string[]) => Promise<Result>,
): Promise<LoadAttemptResult<Result>> {
  try {
    return { ok: true, result: await load(packagePaths(selections)) }
  } catch (error) {
    return { ok: false, error }
  }
}

async function recordFailures<Selection extends RuntimeLoadSelection>(
  selections: readonly Selection[],
  error: unknown,
  recordFailure: (selection: Selection, error: unknown) => Promise<void>,
) {
  for (const selection of selections) {
    await recordFailure(selection, error)
  }
}

async function findViableSelections<Selection extends RuntimeLoadSelection, Result>(
  selections: readonly Selection[],
  load: (packagePaths: readonly string[]) => Promise<Result>,
  recordFailure: (selection: Selection, error: unknown) => Promise<void>,
) {
  const viableSelections: Selection[] = []

  for (const selection of selections) {
    const isolatedAttempt = await captureLoadResult([selection], load)
    if (isolatedAttempt.ok) {
      viableSelections.push(selection)
      continue
    }
    await recordFailure(selection, isolatedAttempt.error)
  }

  return viableSelections
}

async function loadWithViableSelections<Selection extends RuntimeLoadSelection, Result>({
  baseline,
  viableSelections,
  load,
  recordFailure,
}: {
  readonly baseline: Result
  readonly viableSelections: readonly Selection[]
  readonly load: (packagePaths: readonly string[]) => Promise<Result>
  readonly recordFailure: (selection: Selection, error: unknown) => Promise<void>
}) {
  if (viableSelections.length === 0) {
    return baseline
  }

  const viableAttempt = await captureLoadResult(viableSelections, load)
  if (viableAttempt.ok) {
    return viableAttempt.result
  }

  for (const selection of viableSelections) {
    const withoutSelection = viableSelections.filter(
      (candidate) => candidate.packagePath !== selection.packagePath,
    )
    const withoutSelectionAttempt = await captureLoadResult(withoutSelection, load)
    if (!withoutSelectionAttempt.ok) {
      continue
    }

    await recordFailure(selection, viableAttempt.error)
    return withoutSelectionAttempt.result
  }

  await recordFailures(viableSelections, viableAttempt.error, recordFailure)
  return baseline
}

export async function loadWithRuntimeFailureIsolation<
  Selection extends RuntimeLoadSelection,
  Result,
>({
  selections,
  load,
  recordFailure,
}: {
  readonly selections: readonly Selection[]
  readonly load: (packagePaths: readonly string[]) => Promise<Result>
  readonly recordFailure: (selection: Selection, error: unknown) => Promise<void>
}): Promise<Result> {
  const initialAttempt = await captureLoadResult(selections, load)
  if (initialAttempt.ok) {
    return initialAttempt.result
  }
  if (selections.length === 0) {
    throw initialAttempt.error
  }

  const baselineAttempt = await captureLoadResult([], load)
  if (!baselineAttempt.ok) {
    throw initialAttempt.error
  }

  const viableSelections = await findViableSelections(selections, load, recordFailure)

  return loadWithViableSelections({
    baseline: baselineAttempt.result,
    viableSelections,
    load,
    recordFailure,
  })
}
