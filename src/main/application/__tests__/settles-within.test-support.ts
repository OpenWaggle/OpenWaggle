/**
 * Rejects with `message` unless `promise` settles within `milliseconds`. Serialized Session work
 * runs uninterruptibly in places, so an Effect timeout would wait for the very hang it should
 * report; a race returns on time.
 */
export function settlesWithin<A>(promise: Promise<A>, message: string, milliseconds = 1_000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
