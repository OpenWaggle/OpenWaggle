import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useReviewStore } from '@/features/diff-panel/state/review-store';
import { useDiffReviewActions } from '../hooks/useDiffReviewActions';
import { useDiffViewOptions } from '../hooks/useDiffViewOptions';
import { DiffCodeView } from './DiffCodeView';
import { FileTree } from './FileTree';
import { ReviewBar } from './ReviewBar';
/**
 * The diff surface, its Changed-file navigator, and the Review bar.
 *
 * Owns the review concern rather than receiving it: the state is store-backed, so
 * subscribing here keeps DiffPanel free of review wiring and avoids drilling a
 * callback per action through it.
 */
export function DiffReviewBody({ viewerRef, files, isLoading, onSendMessage, onFileClick, }) {
    const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation);
    const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation);
    const { viewOptions } = useDiffViewOptions();
    const review = useDiffReviewActions(onSendMessage, files);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex min-h-0 flex-1 overflow-hidden", children: [_jsx(DiffCodeView, { viewerRef: viewerRef, files: files, isLoading: isLoading, viewOptions: viewOptions, review: {
                            comments: review.comments,
                            activeCommentLocation,
                            onSetActiveComment: setActiveCommentLocation,
                            onAddSingleComment: review.onAddSingleComment,
                            onAddToReview: review.onAddToReview,
                            onRemoveComment: review.onRemoveComment,
                        } }), _jsx(FileTree, { files: files, onFileClick: onFileClick })] }), _jsx(ReviewBar, { commentCount: review.comments.length, summary: review.summary, onSummaryChange: review.onSetSummary, onSubmit: review.onSubmitReview, onDiscard: review.onDiscardReview })] }));
}
