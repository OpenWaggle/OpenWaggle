import { extractDiffSnippet, formatReviewSubmission, formatSingleReviewComment, } from '@/features/diff-panel/lib/review-comment-payload';
import { useReviewStore } from '@/features/diff-panel/state/review-store';
function buildComment(files, location, content) {
    const endLine = location.endLine ?? location.line;
    const patch = files.find((file) => file.path === location.filePath)?.diff ?? '';
    return {
        id: crypto.randomUUID(),
        filePath: location.filePath,
        startLine: location.line,
        endLine,
        content,
        createdAt: Date.now(),
        // Captured now, while the patch that the comment refers to is still on screen.
        diff: patch === '' ? '' : extractDiffSnippet(patch, location.line, endLine),
    };
}
/**
 * Review actions for the diff panel.
 *
 * Two paths, both self-contained in the panel: send one comment immediately, or
 * accumulate a Review and submit it with an optional summary as a single message.
 * Neither touches the composer.
 */
export function useDiffReviewActions(onSendMessage, files) {
    const comments = useReviewStore((s) => s.comments);
    const summary = useReviewStore((s) => s.summary);
    const addComment = useReviewStore((s) => s.addComment);
    const removeComment = useReviewStore((s) => s.removeComment);
    const setSummary = useReviewStore((s) => s.setSummary);
    const discardReview = useReviewStore((s) => s.discardReview);
    const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation);
    function onAddSingleComment(location, content) {
        onSendMessage(formatSingleReviewComment(buildComment(files, location, content)));
        setActiveCommentLocation(null);
    }
    function onAddToReview(location, content) {
        addComment(buildComment(files, location, content));
    }
    function onSubmitReview() {
        // Read imperatively rather than from the render closure. `comments` here is the
        // value from the last render, so a rapid double-click (or a key repeat on the
        // Cmd+Enter shortcut) fires this twice before React re-renders with the cleared
        // array: both calls pass the emptiness guard and the agent receives the same
        // review twice.
        const state = useReviewStore.getState();
        if (state.comments.length === 0)
            return;
        onSendMessage(formatReviewSubmission(state.summary, state.comments));
        state.clearComments();
    }
    return {
        comments,
        summary,
        onAddSingleComment,
        onAddToReview,
        onRemoveComment: removeComment,
        onSetSummary: setSummary,
        onSubmitReview,
        onDiscardReview: discardReview,
    };
}
