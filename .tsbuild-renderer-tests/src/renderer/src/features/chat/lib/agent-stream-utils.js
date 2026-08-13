export function isTerminalTransportEvent(event) {
    if (event.type !== 'agent_end') {
        return false;
    }
    return event.reason !== 'toolUse';
}
