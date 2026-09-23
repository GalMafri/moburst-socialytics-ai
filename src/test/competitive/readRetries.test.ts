import { describe, expect, it } from 'vitest';
import { competitiveReadNodes, competitiveReadRetryOperations } from '../../../n8n/competitive-read-retries.mjs';

const fixture = () => ({ nodes: [
  ...competitiveReadNodes.map(name => ({ name, type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://api.rivaliq.com/v3/landscapes' } })),
  { name: 'Mark Report Complete', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'POST', url: 'https://callback.invalid' } },
] });

describe('competitive read retry patch', () => {
  it('limits retries to the seven idempotent reads, preserving writes and graph', () => {
    const workflow = fixture(); const original = JSON.stringify(workflow);
    const ops = competitiveReadRetryOperations(workflow);
    expect(ops).toHaveLength(7);
    expect(ops.every(op => op.type === 'setNodeSettings' && op.settings.maxTries === 5 && op.settings.waitBetweenTries === 5000)).toBe(true);
    expect(ops.some(op => op.nodeName === 'Mark Report Complete')).toBe(false);
    expect(JSON.stringify(workflow)).toBe(original);
  });
  it('refuses a drifted provider read that has become a write', () => {
    const workflow = fixture(); workflow.nodes[0].parameters.method = 'POST';
    expect(() => competitiveReadRetryOperations(workflow)).toThrow(/non-RivalIQ GET/);
  });
  it('refuses duplicate, absent or redirected nodes', () => {
    const missing = fixture(); missing.nodes.shift();
    expect(() => competitiveReadRetryOperations(missing)).toThrow(/Expected one/);
    const duplicate = fixture(); duplicate.nodes.push(duplicate.nodes[0]);
    expect(() => competitiveReadRetryOperations(duplicate)).toThrow(/Expected one/);
    const redirected = fixture(); redirected.nodes[0].parameters.url = 'https://unrelated.invalid';
    expect(() => competitiveReadRetryOperations(redirected)).toThrow(/non-RivalIQ GET/);
  });
});
