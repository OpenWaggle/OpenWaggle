import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMessageQueueStore } from '@/features/chat/state';
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store';
import { ActionDialog, BranchSummaryPrompt, CompactionStatusStrip, Composer, ComposerBranchRow, QueuedMessages, } from '@/features/composer/components';
import { useScopedComposerDrafts } from '@/features/composer/hooks';
import { SessionContextRow } from '@/features/git';
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/features/waggle/components';
import { useComposerSendGate } from '../hooks/useComposerSendGate';
import { ChatComposerCommandPalette } from './ChatComposerCommandPalette';
import { ChatComposerExtensionDialogs } from './ChatComposerExtensionDialogs';
import { SessionForkSelector } from './SessionForkSelector';
const EMPTY_AGENT_INTERACTIONS = [];
const EMPTY_EXTENSION_PROJECT_PATHS = [];
function noOp() { }
export function ChatComposerStack({ section, agentInteractions = EMPTY_AGENT_INTERACTIONS, extensionRegistry = null, extensionProjectPaths = EMPTY_EXTENSION_PROJECT_PATHS, onRespondAgentInteraction, onOpenSessionTree, }) {
    const { activeSessionId, waggleStatus, commandPaletteOpen, slashSkills, forkSelectorOpen, forkTargets, isLoading, status, compactionStatus, onStopCollaboration, onSelectSkill, onStartWaggle, onSendWithWaggle, onSteer, onCancel, onToast, onSkipBranchSummary, onSummarizeBranch, onStartCustomBranchSummary, onCancelBranchSummary, onOpenForkSelector, onCloseForkSelector, onSelectForkTarget, onCloneToNewSession, } = section;
    useScopedComposerDrafts(activeSessionId);
    const { strip, guardedSend } = useComposerSendGate({
        activeSessionId,
        session: section.session,
        isFirstMessage: section.isFirstMessage,
        onSend: onSendWithWaggle,
        onToast,
    });
    const enqueue = useMessageQueueStore((s) => s.enqueue);
    const branchSummaryMode = useBranchSummaryStore((s) => s.prompt?.mode ?? null);
    const composerDisabledForBranchSummary = branchSummaryMode === 'choice' || branchSummaryMode === 'summarizing';
    const composerPlaceholder = branchSummaryMode === 'custom' ? 'Custom instructions for the branch summary' : undefined;
    return (_jsxs(_Fragment, { children: [_jsx(WaggleCollaborationStatusBanner, { currentSessionId: activeSessionId, onStop: waggleStatus !== 'idle' ? onStopCollaboration : noOp }), _jsx(ChatComposerCommandPalette, { open: commandPaletteOpen, slashSkills: slashSkills, onSelectSkill: onSelectSkill, onStartWaggle: onStartWaggle, onOpenSessionTree: onOpenSessionTree, onForkToNewSession: onOpenForkSelector, onCloneToNewSession: onCloneToNewSession }), _jsx(SessionForkSelector, { open: forkSelectorOpen, targets: forkTargets, onSelect: onSelectForkTarget, onClose: onCloseForkSelector }), _jsxs("div", { className: "mx-auto w-full max-w-[720px] px-5 pb-5", "data-chat-composer-form": "true", children: [compactionStatus ? (_jsx(CompactionStatusStrip, { state: compactionStatus, onCancel: onCancel })) : null, _jsx(QueuedMessages, { sessionId: activeSessionId, onSteer: onSteer, isStreaming: status === 'streaming' || status === 'submitted', isCompacting: status === 'compacting' || status === 'retrying' }), _jsx(BranchSummaryPrompt, { onNoSummary: onSkipBranchSummary, onSummarize: onSummarizeBranch, onCustomSummary: onStartCustomBranchSummary, onCancel: onCancelBranchSummary }), _jsx(ChatComposerExtensionDialogs, { agentInteractions: agentInteractions, extensionProjectPaths: extensionProjectPaths, extensionRegistry: extensionRegistry, onRespond: onRespondAgentInteraction }), _jsx(Composer, { onSend: guardedSend, onEnqueue: (payload) => {
                            if (activeSessionId) {
                                enqueue(activeSessionId, payload);
                            }
                        }, onCancel: onCancel, isLoading: isLoading, mode: {
                            disabled: composerDisabledForBranchSummary,
                            placeholder: composerPlaceholder,
                            requiresText: branchSummaryMode === 'custom',
                            clearOnSubmit: branchSummaryMode !== 'custom',
                            recordHistory: branchSummaryMode !== 'custom',
                            allowEnqueue: branchSummaryMode !== 'custom',
                            sendTitle: branchSummaryMode === 'custom' ? 'Summarize branch' : undefined,
                        }, onToast: onToast }), _jsxs("div", { className: "mt-1.5 flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-3 px-1", children: [_jsx(SessionContextRow, { strip: strip }), _jsx(ComposerBranchRow, { strip: strip, onToast: onToast })] }), _jsx(ActionDialog, { onToast: onToast })] })] }));
}
