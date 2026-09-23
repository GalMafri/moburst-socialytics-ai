// Only idempotent provider reads are eligible. This is bounded collision
// recovery, not an account-wide queue or an hourly-quota workaround.
export const competitiveReadNodes = [
  'List RivalIQ Landscapes', 'Landscape Status', 'Landscape Companies',
  'Landscape Social Posts', 'Landscape Metrics Summary',
  'Landscape Metrics Summary Previous', 'Landscape Metrics Timeseries',
];

export function competitiveReadRetryOperations(workflow) {
  return competitiveReadNodes.map(name => {
    const matches = workflow.nodes.filter(node => node.name === name);
    if (matches.length !== 1) throw new Error(`Expected one ${name}`);
    const node = matches[0];
    if (node.type !== 'n8n-nodes-base.httpRequest' || (node.parameters.method || 'GET') !== 'GET'
      || !String(node.parameters.url).replace(/^=/, '').startsWith('https://api.rivaliq.com/')) {
      throw new Error(`Refusing to retry non-RivalIQ GET: ${name}`);
    }
    return { type: 'setNodeSettings', nodeName: name,
      settings: { retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 } };
  });
}
