import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { $createSkillMentionNode } from '@/features/composer/components';
import { useComposerStore } from '@/features/composer/state';
/** Closes over nothing but the composer store singleton — hoisted to module scope. */
function handleSelectSkill(skillId, skillName) {
    const composerStore = useComposerStore.getState();
    const editor = composerStore.lexicalEditor;
    if (editor) {
        editor.update(() => {
            const root = $getRoot();
            root.clear();
            const paragraph = $createParagraphNode();
            const mentionNode = $createSkillMentionNode(skillId, skillName ?? skillId);
            paragraph.append(mentionNode);
            paragraph.append($createTextNode(' '));
            root.append(paragraph);
            root.selectEnd();
        });
        editor.focus();
    }
    else {
        // Fallback: plain text (no Lexical editor available)
        const currentInput = composerStore.input;
        const nextInput = currentInput === '/' ? `/${skillId} ` : `/${skillId} ${currentInput}`;
        composerStore.setInput(nextInput);
        composerStore.setCursorIndex(nextInput.length);
    }
}
export function useComposerSection(params) {
    const { isLoading, isSteering, status, compactionStatus, activeSessionId, waggleStatus, commandPaletteOpen, slashSkills, forkSelectorOpen, forkTargets, phase, stop, showToast, handleSteer, handleSendWithWaggle, handleStartWaggle, handleStopCollaboration, handleSkipBranchSummary, handleSummarizeBranch, handleStartCustomBranchSummary, handleCancelBranchSummary, handleOpenForkSelector, handleCloseForkSelector, handleSelectForkTarget, handleCloneToNewSession, } = params;
    const isFirstMessage = params.isFirstMessage;
    return {
        activeSessionId,
        session: params.session,
        isFirstMessage,
        waggleStatus,
        commandPaletteOpen,
        slashSkills,
        forkSelectorOpen,
        forkTargets,
        isLoading: isLoading || isSteering || phase.current !== null,
        status,
        compactionStatus,
        onStopCollaboration: handleStopCollaboration,
        onSelectSkill: handleSelectSkill,
        onStartWaggle: handleStartWaggle,
        onSendWithWaggle: handleSendWithWaggle,
        onSteer: handleSteer,
        onCancel: stop,
        onToast: showToast,
        onSkipBranchSummary: handleSkipBranchSummary,
        onSummarizeBranch: handleSummarizeBranch,
        onStartCustomBranchSummary: handleStartCustomBranchSummary,
        onCancelBranchSummary: handleCancelBranchSummary,
        onOpenForkSelector: handleOpenForkSelector,
        onCloseForkSelector: handleCloseForkSelector,
        onSelectForkTarget: handleSelectForkTarget,
        onCloneToNewSession: handleCloneToNewSession,
    };
}
