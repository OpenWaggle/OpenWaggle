/*
 * Model runs that once failed, replayed by action names (minimised where noted): each guards the
 * fix named by its test in transcript-order-model.component.test.tsx.
 */

/*
 * Seed 121097 at 45 steps, before promotions could repeat a prompt's text. A Run's prompt and steers
 * were lost in a stall and its answer streamed live, so only that answer is a settled row when the
 * Run goes on to a queued Follow-up: no settled user row of the Run vouches for its saved copy, and
 * the answer showed twice until the chain ended.
 */
export const SEED_121097 = (
  'holdHostReads viewOther viewSession releaseReconnects holdHostReads stall startRun ' +
  'releaseReconnects compact holdHostReads answer steer releaseReconnects compact answer steer ' +
  'answer resume viewOther stop holdHostReads stall startRun steer retry resume viewSession ' +
  'answer touch refresh continues retry touch refresh steer continues retry steer releaseReconnects'
).split(' ')

/*
 * Seed 408 at 26 steps: a Run started while the earlier Run's settlement was still on its way, in
 * a snapshot a route wrote, and retried; the late settlement then took its rows for the earlier
 * Run's and the reload after it lost "answer 1".
 */
export const SEED_408 = (
  'startRun retry viewSession compact endRunSettlingLate holdReconnects touch viewOther ' +
  'releaseReconnects touch holdReconnects viewSession startRun answer promote releaseReconnects ' +
  'compact viewOther answer viewSession retry refresh refresh promote deliverSettlement'
).split(' ')

/*
 * Seed 196 at 26 steps: before the earlier Run's settlement arrived, a resync rehydrated the next
 * Run from a detail holding the earlier one, which then showed under both ids.
 */
/*
 * Seed 5457 at 45 steps: a Run whose start was lost in a stall resumed under the bridge's unnamed
 * start, a route wrote its snapshot, and its retry (named) was taken for a new Run: the late
 * settlement of the Run before then took every row for that Run's and "answer 4" was lost.
 */
export const SEED_5457 = (
  'send steer endRun stall startRun steer compact holdHostReads releaseReconnects compact promote ' +
  'resume compact refresh answer holdHostReads touch promote touch compact deliverPromotion retry ' +
  'touch promote answer refresh releaseReconnects'
).split(' ')

/*
 * Seed 5023 at 45 steps: a Run under an unnamed start ended with its settlement on its way, and the
 * next Run's start was taken for that Run's real one, so the ended Run's answers showed twice.
 */
export const SEED_5023 = (
  'startRun answerWithGap retry compact answerWithGap retry restartHost touch compactManually ' +
  'compactManually reloadRenderer startRun reloadRenderer answerWithGap stop stall startRun steer ' +
  'promote compact deliverPromotion holdHostReads resume touch stall answer promote ' +
  'deliverPromotion compact compact compact retry retry resume answer answer refresh ' +
  'endRunSettlingLate viewOther answerPromotion startRun touch releaseReconnects viewSession'
).split(' ')

/*
 * Seed 170109 at 100 steps: a promoted steer Pi took during a stall, its Session not shown, ended
 * with its Run; that Run's settlement came after the next Run started, so its preview stayed and
 * sat below the next Run's prompt.
 */
export const SEED_170109 = (
  'startRun holdHostReads compact steer releaseReconnects answer steer answer stop refresh ' +
  'refresh stall holdHostReads resume touch releaseReconnects holdHostReads stall startRun ' +
  'retry answer resume compact compact continues refresh retry releaseReconnects stop startRun ' +
  'viewSession viewOther refresh endRun holdReconnects stall startRun retry answer answer steer ' +
  'releaseReconnects retry holdHostReads steer compact retry answer compact releaseReconnects ' +
  'compact answer compact steer answer resume stop touch refresh reloadRenderer refresh ' +
  'compactManually viewSession touch holdHostReads refresh refresh compactManually refresh ' +
  'compactManually startRun retry promote refresh retry viewOther refresh touch stall retry ' +
  'compact releaseReconnects retry deliverPromotion answer compact resume answer holdReconnects ' +
  'endRunSettlingLate touch startRun viewSession'
).split(' ')

/*
 * Seed 210214 at 70 steps (minimised): two promoted steers say "continue"; the first was taken in a
 * stall, and the second one's row was credited to the first preview, out of promotion order.
 */
export const SEED_210214 = (
  'startRun stall answer answer promote promote answer holdHostReads deliverPromotion resume ' +
  'promote answerPromotion deliverPromotion deliverPromotion'
).split(' ')

/*
 * Seed 200598 at 100 steps (minimised): the Session left while its Run went on to a queued
 * Follow-up with Host reads held; back on it, the Run ended with its settlement late and the next
 * Run started before the held reads were answered, and the first Run was missing until the end.
 */
export const SEED_200598 = (
  'startRun answer steer steer steer answer steer viewOther holdHostReads steer continues ' +
  'viewSession endRunSettlingLate startRun releaseReconnects'
).split(' ')

/*
 * Seed 707 at 26 steps: a Run whose start was lost in a stall resumed under the bridge's unnamed
 * start and ended with its settlement late; the next Run started first, and the settlement, naming
 * an id the renderer never saw start, was taken for the Session settling and lost the next Run.
 */
export const SEED_707 = (
  'holdHostReads releaseReconnects compactManually compactManually send restartHost viewOther ' +
  'stall resume touch failBeforeStart stall holdHostReads releaseReconnects startRun ' +
  'holdReconnects retry resume viewSession endRunSettlingLate startRun promote promote ' +
  'releaseReconnects deliverSettlement'
).split(' ')

/*
 * Seed 230320 at 45 steps: the renderer reloaded mid-Run, so it never saw that Run start; the Run
 * ended with its settlement late, the next Run started first, and the settlement was taken for the
 * Session settling and dropped the next Run's prompt.
 */
export const SEED_230320 = (
  'startRun reloadRenderer answerWithGap answer touch answerWithGap endRunSettlingLate startRun ' +
  'holdReconnects deliverSettlement'
).split(' ')

/*
 * Seeds 263171 and 263241 at 70 steps: a Run the renderer knew only by the bridge's unnamed start
 * (it started during a stall, or the Host restarted) ended and Pi continued it under its own id;
 * that start was taken for another Run's, and the unnamed Run's answers were dropped as settled.
 */
export const SEED_263171 = 'stall startRun resume answer answer continueRun viewSession'.split(' ')
export const SEED_263241 =
  'viewSession startRun restartHost stall startRun resume answer continueRun answerWithGap'.split(
    ' ',
  )

/*
 * Review r7: the Host settled a Run sent from the route, clearing its buffer, before its
 * run-completed reached the renderer, so a held background reconnect found no buffer; the Run's
 * own prompt counted as settled from its start, and its answers showed twice.
 */
export const HOST_SETTLED_FIRST = (
  'send answer endRun send answer viewOther holdHostReads viewSession answer endRunSettlingLate ' +
  'releaseReconnects deliverSettlement'
).split(' ')

/*
 * Seed 320289 at 45 steps (review r8): a Run the renderer saw only answering went on to its
 * Follow-up and settled while a background reconnect's detail read was held; the reconnect merged
 * with the settled ids hydration captured before, and showed the settled answer twice.
 */
export const SEED_320289 = (
  'holdHostReads stall startRun resume answer viewSession continues endRunSettlingLate ' +
  'releaseReconnects'
).split(' ')

/*
 * Seed 340281 at 100 steps: a Run started in a stall settled at the Host while the resync's
 * reconnect held its detail read; with no buffer left and no row of the Run's start shown, the
 * reconnect scoped no answer, and the Run's answer showed twice.
 */
export const SEED_340281 = (
  'viewSession startRun stop compactManually stall startRun holdHostReads resume answer ' +
  'endRunSettlingLate'
).split(' ')

/*
 * Seed 350207 at 45 steps (review r9): a Run started in a stall settled at the Host while the
 * resync's reconnect held its detail read; with no buffer at the second read, the user messages of
 * the first were never placed, and the next send kept the transcript without them.
 */
export const SEED_350207 = (
  'send endRun holdReconnects stall startRun answer resume endRunSettlingLate releaseReconnects ' +
  'send touch'
).split(' ')
/* The full seed: the placed messages go before the answers the Run streamed after them. */
export const SEED_350207_FULL = (
  'send viewOther compact answer compact answer stall compact compact answer resume endRun ' +
  'reloadRenderer viewSession stall holdReconnects resume stall startRun steer compact answer ' +
  'answer answer retry compact resume compact answer endRunSettlingLate releaseReconnects send ' +
  'promote touch'
).split(' ')

/*
 * Seed 370043 at 45 steps: the resync's reconnect read a Run's buffer, then the next Run's (a
 * Follow-up); its detail predated the first Run's save, and the reconnect was dropped, so the first
 * Run's prompt stayed missing. The detail is read again after the second buffer read.
 */
export const SEED_370043 =
  'stall startRun holdHostReads resume continues releaseReconnects endRunSettlingLate send refresh'.split(
    ' ',
  )

/*
 * Seed 380015 at 100 steps: a Run known only by the bridge's unnamed start ended and the next Run
 * started; with the ended Run unnamed, that start did not count as another Run's, and a promoted
 * steer the first Run took in a stall kept its preview below the next Run's prompt.
 */
export const SEED_380015 = (
  'stall startRun steer answer continueRun steer continueRun resume promote viewOther stall ' +
  'continueRun deliverPromotion resume endRunSettlingLate holdHostReads startRun viewSession'
).split(' ')

export const SEED_196 = (
  'touch holdReconnects touch viewSession startRun answer stall resume endRunSettlingLate ' +
  'startRun releaseReconnects answerWithGap'
).split(' ')

/*
 * Seed 392631 at 100 steps: a Run ended and was saved while a stall hid its end and settlement;
 * a held read then rehydrated the "active" Run from a detail holding its saved answer, which showed
 * under both ids.
 */
export const SEED_392631 = (
  'viewSession send holdHostReads endRunWithRequestedWaggle startRun answer stall endRun ' +
  'releaseReconnects'
).split(' ')

/*
 * Seeds 430033, 430057 and 430218 at 100 steps (review r11): a stall covered the settlement of the
 * Run a send started (a Follow-up, a continuation's steer, a whole Run after it); the resync relayed
 * it, but the send's reconnect read only the buffer, and the rows Runs saved meanwhile stayed
 * missing until the Session went idle.
 */
export const SEED_430033 = 'send stall continues continues resume'.split(' ')
export const SEED_430057 = 'send stall continueRun continues resume'.split(' ')
export const SEED_430218 = 'viewSession send stall endRun startRun endRun startRun resume'.split(
  ' ',
)

/*
 * Seed 455984 at 70 steps: a buffer holding no finished answers ran the next Run while
 * a stall hid the send's Run ending; the earlier Run's prompt, shown under its optimistic id and
 * held by the transcript at its log order, was taken for a row only this renderer showed, and the
 * next Run's live answer landed above that Run's prompt.
 */
export const SEED_455984 = (
  'send stall endRunSettlingLate startRun holdReconnects dropHistory resume answer answer ' +
  'releaseReconnects'
).split(' ')

/*
 * Seed 531523 at 45 steps: a stall hid a Run's end and the next Run's start; a held detail read
 * landed with the Run saved while the transcript still streamed its answer, but the dedupe looked
 * only in the next Run's span, and the answer showed twice.
 */
export const SEED_531523 = (
  'startRun restartHost failBeforeStart holdHostReads viewSession compactManually startRun continues ' +
  'answerWithReasoning stall serveHeldReads continues releaseReconnects'
).split(' ')

/*
 * Seed 530421 at 70 steps: as 531523, but the stall lost the Run's prompt too and no buffer was
 * left: the dedupe span starts after the last row shown under its Pi id.
 */
export const SEED_530421 = (
  'startRun stop viewSession send stop startRun restartHost startRun continues ' +
  'holdHostReads endRun stall startRun resume answerWithReasoning stall endRunWithRequestedWaggle releaseReconnects'
).split(' ')

/*
 * Seeds 562217 and 564032 at 100 steps (review parts-v3): the model rebuilt an older Host's buffer,
 * which joined the texts around an empty thought into one part; matched by content with its saved
 * copy (two parts) it showed twice once the Run settled. A revision-22 GUI never reads such a
 * buffer, so the model no longer builds it; an answer's content key now reads the text between two
 * tool calls as one however it is split (`answer-content-key.unit.test.ts`).
 */
export const SEED_562217 = (
  'holdHostReads stall startRun resume dropHistory continueRun answer answer ' +
  'answerWithReasoning endRunSettlingLate'
).split(' ')
export const SEED_564032 = (
  'holdReconnects startRun steer answerWithReasoning continueRun dropHistory answerWithReasoning ' +
  'touch viewOther endRunSettlingLate viewSession'
).split(' ')

/*
 * Seed 561547 at 100 steps: a Run started, took a promoted steer and settled inside a stall, so
 * the renderer never saw it; the resync found the Session idle but kept the steer's preview, which
 * then claimed the row of a later steer with the same text and showed beside it.
 */
export const SEED_561547 = (
  'startRun answerWithReasoning answerWithReasoning endRun viewSession stall startRun promote answer ' +
  'continueRun deliverPromotion endRun resume send promote deliverPromotion'
).split(' ')
