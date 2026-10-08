/**
 * Bounds how long an accepted connection may take to complete its Local Session handshake,
 * without blaming the client for time the Host spent blocked.
 *
 * The deadline is a wall-clock timer, and a timer measures the whole process, not the peer. After
 * a synchronous stall Node runs expired timers before it reads sockets, so a hello already waiting
 * in the socket buffer looked late. A late timer is therefore not a verdict: the deadline restarts
 * when it fires noticeably after it was due, at most `MAX_LATE_REARMS` times, and a received hello
 * earns one more period for authentication. Otherwise a deadline that fires after pending input
 * has been read expires, and the connection reports that expiry as retryable: reconnecting later
 * is the right response.
 */
const LATE_FIRE_FRACTION_DENOMINATOR = 4
/** A Host that keeps stalling still closes a handshake that has not finished. */
const MAX_LATE_REARMS = 3

export class LocalSessionHandshakeDeadline {
  private timer: ReturnType<typeof setTimeout> | undefined
  private dueAt = 0
  private helloReceived = false
  private authenticationGraceUsed = false
  private lateRearms = 0
  private settled = false
  private didExpire = false

  constructor(
    private readonly timeoutMs: number,
    private readonly expire: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.arm()
  }

  /** The deadline passed and the connection was told so; late handshake work must not admit it. */
  get expired(): boolean {
    return this.didExpire
  }

  markHelloReceived(): void {
    this.helloReceived = true
  }

  clear(): void {
    this.settled = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private arm() {
    this.dueAt = this.now() + this.timeoutMs
    this.timer = setTimeout(() => this.fired(), this.timeoutMs)
  }

  private isLate() {
    return this.now() - this.dueAt > this.timeoutMs / LATE_FIRE_FRACTION_DENOMINATOR
  }

  private fired() {
    this.timer = undefined
    if (this.settled) return
    const firedLate = this.isLate()
    // setImmediate runs after the I/O poll, so a hello that arrived during a stall is read first.
    setImmediate(() => {
      if (this.settled) return
      // A stall can also land between this timer and the poll, for example in a later timer.
      if ((firedLate || this.isLate()) && this.lateRearms < MAX_LATE_REARMS) {
        this.lateRearms += 1
        return this.arm()
      }
      if (this.helloReceived && !this.authenticationGraceUsed) {
        this.authenticationGraceUsed = true
        return this.arm()
      }
      this.settled = true
      this.didExpire = true
      this.expire()
    })
  }
}
