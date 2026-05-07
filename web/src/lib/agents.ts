export const AGENT_NAMES: Record<string, string> = {
  main: 'Ivonne',
  ops: 'Taylor',
  comms: 'Charlie',
  content: 'Jennifer',
  research: 'Laura',
  llina_agent: 'Lina',
  Camila_Agent: 'Camila',
  Rodrigo_Agent: 'Rodrigo',
  Jann_Agent: 'Jann',
  carlos_agent: 'Carlos',
};

export function agentDisplayName(agentId: string): string {
  return AGENT_NAMES[agentId] || agentId;
}

export function agentHandle(agentId: string): string {
  return '@' + agentDisplayName(agentId);
}
