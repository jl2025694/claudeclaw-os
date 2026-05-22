import { useRoute } from 'wouter-preact';
import { Agents } from './Agents';

/** Thin wrapper: renders the full Agents page pre-filtered to a group.
 *  The group name is taken from the URL: /groups/:group
 *  e.g. /groups/negocios, /groups/familia, /groups/personal
 */
export function AgentGroup() {
  const [, params] = useRoute('/groups/:group');
  const group = params?.group ?? '';
  return <Agents filterGroup={group} />;
}
