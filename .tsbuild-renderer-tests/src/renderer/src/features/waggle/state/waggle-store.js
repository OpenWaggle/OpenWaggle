import { matchBy } from '@diegogbrisa/ts-match';
import { isInheritedWaggleModelBinding, } from '@shared/types/waggle';
import { create } from 'zustand';
export const useWaggleStore = create((set) => ({
    activeCollaborationId: null,
    configSessionId: null,
    activeConfig: null,
    status: 'idle',
    currentTurn: 0,
    currentAgentIndex: 0,
    currentAgentLabel: '',
    initialTurnMeta: null,
    completedTurnMeta: [],
    liveMessageMetadata: {},
    fileConflicts: [],
    lastConsensusResult: null,
    completionReason: null,
    setConfig(config, sessionId) {
        set({ activeConfig: config, configSessionId: sessionId });
    },
    clearConfig() {
        set({ activeConfig: null, configSessionId: null });
    },
    startCollaboration(sessionId, config) {
        const firstAgent = config.agents[0];
        set({
            activeCollaborationId: sessionId,
            configSessionId: sessionId,
            activeConfig: config,
            status: 'running',
            currentTurn: 0,
            currentAgentIndex: 0,
            currentAgentLabel: firstAgent.label,
            initialTurnMeta: {
                agentIndex: 0,
                agentLabel: firstAgent.label,
                agentColor: firstAgent.color,
                ...(!isInheritedWaggleModelBinding(firstAgent.model)
                    ? { agentModel: firstAgent.model }
                    : {}),
                turnNumber: 0,
            },
            completedTurnMeta: [],
            liveMessageMetadata: {},
            fileConflicts: [],
            lastConsensusResult: null,
            completionReason: null,
        });
    },
    handleTurnEvent(event) {
        matchBy(event, 'type')
            .with('turn-start', (value) => {
            set({
                currentTurn: value.turnNumber,
                currentAgentIndex: value.agentIndex,
                currentAgentLabel: value.agentLabel,
            });
        })
            .with('consensus-reached', (value) => {
            set({ lastConsensusResult: value.result });
        })
            .with('file-conflict', (value) => {
            set((s) => ({ fileConflicts: [...s.fileConflicts, value.warning] }));
        })
            .with('collaboration-complete', (value) => {
            set({
                status: 'completed',
                completionReason: value.reason,
            });
        })
            .with('collaboration-stopped', (value) => {
            set({
                status: 'stopped',
                completionReason: value.reason,
            });
        })
            .with('turn-end', (value) => {
            set((s) => ({
                completedTurnMeta: [
                    ...s.completedTurnMeta,
                    {
                        agentIndex: value.agentIndex,
                        agentLabel: value.agentLabel,
                        agentColor: value.agentColor,
                        agentModel: value.agentModel,
                        turnNumber: value.turnNumber,
                    },
                ],
            }));
        })
            .exhaustive();
    },
    trackMessageMetadata(messageId, meta) {
        set((s) => ({
            liveMessageMetadata: { ...s.liveMessageMetadata, [messageId]: meta },
        }));
    },
    stopCollaboration() {
        set({ status: 'stopped' });
    },
    reset() {
        set({
            activeCollaborationId: null,
            configSessionId: null,
            activeConfig: null,
            status: 'idle',
            currentTurn: 0,
            currentAgentIndex: 0,
            currentAgentLabel: '',
            initialTurnMeta: null,
            completedTurnMeta: [],
            liveMessageMetadata: {},
            fileConflicts: [],
            lastConsensusResult: null,
            completionReason: null,
        });
    },
}));
