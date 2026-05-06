export const AGENT_NAMES: Record<string, string> = {
  main: 'Ivonne - Main',
  ops: 'Taylor - ops',
  comms: 'Charlie - comms',
  content: 'Jennifer - content',
  research: 'Laura - research',
};

export function agentDisplayName(agentId: string): string {
  return AGENT_NAMES[agentId] || agentId;
}

export function agentHandle(agentId: string): string {
  return '@' + agentDisplayName(agentId);
}
