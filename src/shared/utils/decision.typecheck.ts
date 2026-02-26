import { choose, chooseBy } from './decision'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Expect<T extends true> = T

type Entry =
  | { kind: 'alpha'; value: number }
  | { kind: 'beta'; value: string }
  | { kind: 'gamma'; value: boolean }

const entry: Entry =
  Math.random() > 0.5
    ? { kind: 'alpha', value: 1 }
    : Math.random() > 0.5
      ? { kind: 'beta', value: 'x' }
      : { kind: 'gamma', value: true }

const exact = chooseBy(entry, 'kind')
  .case('alpha', (v) => v.value.toFixed(0))
  .case('beta', (v) => v.value.toUpperCase())
  .case('gamma', (v) => (v.value ? 'yes' : 'no'))
  .assertComplete()

type _exactType = Expect<Equal<typeof exact, string>>

const guarded = choose(entry)
  .case({ kind: 'alpha' }, (value) => value.value)
  .catchAll(() => 0)

type _guardedType = Expect<Equal<typeof guarded, string | number | boolean>>

const incomplete = chooseBy(entry, 'kind').case('alpha', (v) => v.value)
// @ts-expect-error chooseBy.assertComplete must fail when not all tags are handled
incomplete.assertComplete()
