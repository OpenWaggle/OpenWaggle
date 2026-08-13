import { matchBy } from '@diegogbrisa/ts-match';
export function agentLoopInteractionTitle(interaction) {
    return matchBy(interaction, 'kind')
        .with('confirm', 'select', 'input', 'editor', (value) => value.title)
        .with('notify', () => 'Notification')
        .with('custom', (value) => `Custom interaction · ${value.customType}`)
        .exhaustive();
}
export function agentLoopInteractionMessage(interaction) {
    return matchBy(interaction, 'kind')
        .with('confirm', 'notify', (value) => value.message)
        .with('custom', () => 'This custom Pi interaction requires an OpenWaggle desktop renderer. Pi TUI components are not executed inside Electron.')
        .with('select', 'input', 'editor', () => undefined)
        .exhaustive();
}
export function agentLoopInteractionRequiresDesktopRenderer(interaction) {
    return matchBy(interaction, 'kind')
        .with('custom', () => true)
        .with('confirm', 'select', 'input', 'editor', 'notify', () => false)
        .exhaustive();
}
function extensionInteractionActions(interaction) {
    return matchBy(interaction, 'kind')
        .with('confirm', () => [
        { id: 'accept', label: 'Approve', tone: 'primary' },
        { id: 'reject', label: 'Decline', tone: 'secondary' },
    ])
        .with('select', (value) => value.choices.map((choice) => ({ id: choice, label: choice })))
        .with('input', 'editor', () => [
        { id: 'submit', label: 'Submit', tone: 'primary' },
        { id: 'cancel', label: 'Cancel', tone: 'secondary' },
    ])
        .with('notify', () => [{ id: 'acknowledge', label: 'Acknowledge', tone: 'primary' }])
        .with('custom', () => [])
        .exhaustive();
}
export function toExtensionInteractionView(interaction, state = 'pending') {
    const message = agentLoopInteractionMessage(interaction);
    const customType = interaction.kind === 'custom' ? interaction.customType : interaction.kind;
    return {
        id: interaction.interactionId,
        kind: interaction.kind,
        title: agentLoopInteractionTitle(interaction),
        customType,
        ...(interaction.kind === 'custom' && interaction.payload !== undefined
            ? { payload: interaction.payload }
            : {}),
        ...(message !== undefined ? { description: message } : {}),
        state,
        actions: extensionInteractionActions(interaction),
    };
}
