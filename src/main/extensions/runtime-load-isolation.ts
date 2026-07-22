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
  const paths = new Set<string>()
  for (const selection of selections) {
    paths.add(selection.packagePath)
  }
  return [...paths]
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
  async function recordAt(index: number): Promise<void> {
    const selection = selections[index]
    if (selection === undefined) {
      return
    }

    await recordFailureSafely(selection, error, recordFailure)
    await recordAt(index + 1)
  }

  await recordAt(0)
}

async function recordFailureSafely<Selection extends RuntimeLoadSelection>(
  selection: Selection,
  error: unknown,
  recordFailure: (selection: Selection, error: unknown) => Promise<void>,
) {
  try {
    await recordFailure(selection, error)
  } catch {
    // Failure recording is best-effort; it must not break the safe fallback load.
  }
}

async function findViableSelections<Selection extends RuntimeLoadSelection, Result>(
  selections: readonly Selection[],
  load: (packagePaths: readonly string[]) => Promise<Result>,
  recordFailure: (selection: Selection, error: unknown) => Promise<void>,
) {
  const viableSelections: Selection[] = []

  async function inspectAt(index: number): Promise<void> {
    const selection = selections[index]
    if (selection === undefined) {
      return
    }

    const isolatedAttempt = await captureLoadResult([selection], load)
    if (isolatedAttempt.ok) {
      viableSelections.push(selection)
    } else {
      await recordFailureSafely(selection, isolatedAttempt.error, recordFailure)
    }

    await inspectAt(index + 1)
  }

  await inspectAt(0)
  return viableSelections
}

async function loadWithoutFailingSelection<Selection extends RuntimeLoadSelection, Result>({
  error,
  index,
  load,
  recordFailure,
  viableSelections,
}: {
  readonly error: unknown
  readonly index: number
  readonly load: (packagePaths: readonly string[]) => Promise<Result>
  readonly recordFailure: (selection: Selection, error: unknown) => Promise<void>
  readonly viableSelections: readonly Selection[]
}): Promise<LoadAttemptResult<Result>> {
  const selection = viableSelections[index]
  if (selection === undefined) {
    return { ok: false, error }
  }

  const withoutSelection = viableSelections.filter(
    (candidate) => candidate.packagePath !== selection.packagePath,
  )
  const attempt = await captureLoadResult(withoutSelection, load)
  if (!attempt.ok) {
    return loadWithoutFailingSelection({
      error,
      index: index + 1,
      load,
      recordFailure,
      viableSelections,
    })
  }

  await recordFailureSafely(selection, error, recordFailure)
  return attempt
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

  const withoutFailingSelectionAttempt = await loadWithoutFailingSelection({
    error: viableAttempt.error,
    index: 0,
    load,
    recordFailure,
    viableSelections,
  })
  if (withoutFailingSelectionAttempt.ok) {
    return withoutFailingSelectionAttempt.result
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
