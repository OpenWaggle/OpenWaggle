import { match } from '@diegogbrisa/ts-match';
import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop';
import { SessionId } from '@shared/types/brand';
import { isObject, numberField, optionalJsonValue, stringField, } from './agent-loop-transcript-event-fields';
function baseInteractionFields(interaction) {
    const interactionId = stringField(interaction, 'interactionId');
    const sessionId = stringField(interaction, 'sessionId');
    const runId = stringField(interaction, 'runId');
    const source = stringField(interaction, 'source');
    const createdAt = numberField(interaction, 'createdAt');
    if (interactionId === null ||
        sessionId === null ||
        runId === null ||
        source !== 'pi-ui' ||
        createdAt === null) {
        return null;
    }
    const base = {
        interactionId,
        sessionId: SessionId(sessionId),
        runId,
        source: 'pi-ui',
        createdAt,
    };
    const timeoutMs = numberField(interaction, 'timeoutMs');
    return timeoutMs !== null ? { ...base, timeoutMs } : base;
}
function parseChoices(value) {
    return Array.isArray(value) && value.every((choice) => typeof choice === 'string') ? value : null;
}
function parseConfirmInteraction(base, interaction) {
    const title = stringField(interaction, 'title');
    const message = stringField(interaction, 'message');
    return title !== null && message !== null ? { ...base, kind: 'confirm', title, message } : null;
}
function parseSelectInteraction(base, interaction) {
    const title = stringField(interaction, 'title');
    const choices = parseChoices(interaction.choices);
    return title !== null && choices !== null ? { ...base, kind: 'select', title, choices } : null;
}
function parseInputInteraction(base, interaction) {
    const title = stringField(interaction, 'title');
    const placeholder = stringField(interaction, 'placeholder');
    return title !== null
        ? { ...base, kind: 'input', title, ...(placeholder !== null ? { placeholder } : {}) }
        : null;
}
function parseEditorInteraction(base, interaction) {
    const title = stringField(interaction, 'title');
    const prefill = stringField(interaction, 'prefill');
    return title !== null
        ? { ...base, kind: 'editor', title, ...(prefill !== null ? { prefill } : {}) }
        : null;
}
function parseNotifyInteraction(base, interaction) {
    const message = stringField(interaction, 'message');
    const level = stringField(interaction, 'level');
    if (message === null || (level !== 'info' && level !== 'warning' && level !== 'error')) {
        return null;
    }
    return { ...base, kind: 'notify', message, level };
}
function parseCustomInteraction(base, interaction) {
    const customType = stringField(interaction, 'customType') ?? OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE;
    const payload = optionalJsonValue(interaction.payload);
    const renderer = isObject(interaction.renderer) ? interaction.renderer : null;
    const factoryName = renderer === null ? null : stringField(renderer, 'factoryName');
    const overlay = renderer?.overlay;
    return {
        ...base,
        kind: 'custom',
        customType,
        ...(payload !== undefined ? { payload } : {}),
        renderer: {
            kind: 'pi-tui-custom',
            supported: false,
            ...(factoryName !== null ? { factoryName } : {}),
            ...(typeof overlay === 'boolean' ? { overlay } : {}),
        },
    };
}
export function parseInteraction(interaction) {
    if (!isObject(interaction)) {
        return null;
    }
    const base = baseInteractionFields(interaction);
    if (base === null) {
        return null;
    }
    return match(interaction.kind)
        .with('confirm', () => parseConfirmInteraction(base, interaction))
        .with('select', () => parseSelectInteraction(base, interaction))
        .with('input', () => parseInputInteraction(base, interaction))
        .with('editor', () => parseEditorInteraction(base, interaction))
        .with('notify', () => parseNotifyInteraction(base, interaction))
        .with('custom', () => parseCustomInteraction(base, interaction))
        .otherwise(() => null);
}
export function parseErrorInfo(error) {
    if (!isObject(error)) {
        return undefined;
    }
    const message = stringField(error, 'message');
    if (message === null) {
        return undefined;
    }
    const code = stringField(error, 'code');
    const name = stringField(error, 'name');
    const stack = stringField(error, 'stack');
    return {
        message,
        ...(code !== null ? { code } : {}),
        ...(name !== null ? { name } : {}),
        ...(stack !== null ? { stack } : {}),
    };
}
export function parseInteractionKind(value) {
    if (value === 'confirm' ||
        value === 'select' ||
        value === 'input' ||
        value === 'editor' ||
        value === 'notify' ||
        value === 'custom') {
        return value;
    }
    return null;
}
export function parseInteractionStatus(value) {
    if (value === 'pending' || value === 'resolved' || value === 'cancelled' || value === 'errored') {
        return value;
    }
    return null;
}
