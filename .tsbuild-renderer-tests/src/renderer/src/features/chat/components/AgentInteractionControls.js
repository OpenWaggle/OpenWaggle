import { jsx as _jsx } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { AgentInteractionConfirmControls } from './AgentInteractionConfirmControls';
import { AgentInteractionEditorControls } from './AgentInteractionEditorControls';
import { AgentInteractionInputControls } from './AgentInteractionInputControls';
import { AgentInteractionSelectControls } from './AgentInteractionSelectControls';
export function AgentInteractionControls({ interaction, busy, submit, }) {
    return matchBy(interaction, 'kind')
        .with('confirm', () => _jsx(AgentInteractionConfirmControls, { busy: busy, submit: submit }))
        .with('select', (value) => (_jsx(AgentInteractionSelectControls, { interaction: value, busy: busy, submit: submit })))
        .with('input', (value) => (_jsx(AgentInteractionInputControls, { interaction: value, busy: busy, submit: submit })))
        .with('editor', (value) => (_jsx(AgentInteractionEditorControls, { interaction: value, busy: busy, submit: submit })))
        .with('notify', 'custom', () => null)
        .exhaustive();
}
