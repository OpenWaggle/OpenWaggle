/**
 * Counts what the Session Host's SQLite connection does while a workload runs: statements executed
 * and rows they return. It wraps better-sqlite3's statement methods, which every OpenWaggle
 * connection uses (`@effect/sql-sqlite-node` and `host-sqlite-database.ts`), so nothing about the
 * store or its queries is replaced.
 */
import Database from 'better-sqlite3'

export interface SqliteWork {
  /** Statements run through `all`, `get`, `iterate` or `run`. */
  readonly statements: number
  /** Rows the statements returned to the caller. */
  readonly rows: number
}

type Method<R> = (this: unknown, ...params: unknown[]) => R

interface StatementMethods {
  all: Method<unknown[]>
  get: Method<unknown>
  iterate: Method<IterableIterator<unknown>>
  run: Method<unknown>
}

const METHOD_NAMES = ['all', 'get', 'iterate', 'run'] as const

function isStatementMethods(value: unknown): value is StatementMethods {
  return (
    typeof value === 'object' &&
    value !== null &&
    METHOD_NAMES.every((name) => typeof Reflect.get(value, name) === 'function')
  )
}

/** The prototype every better-sqlite3 statement shares, found through a throwaway statement. */
function statementPrototype() {
  const probe = new Database(':memory:')
  try {
    const prototype: unknown = Object.getPrototypeOf(probe.prepare('SELECT 1'))
    if (!isStatementMethods(prototype)) {
      throw new Error('better-sqlite3 statements no longer have all, get, iterate and run.')
    }
    return prototype
  } finally {
    probe.close()
  }
}

/** Starts counting; `take` returns the work since the last take, `restore` stops counting. */
export function meterSqliteWork() {
  const prototype = statementPrototype()
  const original: StatementMethods = {
    all: prototype.all,
    get: prototype.get,
    iterate: prototype.iterate,
    run: prototype.run,
  }
  let statements = 0
  let rows = 0
  prototype.all = function all(...params) {
    statements += 1
    const result = original.all.apply(this, params)
    rows += result.length
    return result
  }
  prototype.get = function get(...params) {
    statements += 1
    const result = original.get.apply(this, params)
    if (result !== undefined) rows += 1
    return result
  }
  prototype.iterate = function* iterate(...params) {
    statements += 1
    for (const row of original.iterate.apply(this, params)) {
      rows += 1
      yield row
    }
  }
  prototype.run = function run(...params) {
    statements += 1
    return original.run.apply(this, params)
  }
  return {
    take() {
      const work = { statements, rows }
      statements = 0
      rows = 0
      return work
    },
    restore() {
      Object.assign(prototype, original)
    },
  }
}

export type SqliteWorkMeter = ReturnType<typeof meterSqliteWork>
