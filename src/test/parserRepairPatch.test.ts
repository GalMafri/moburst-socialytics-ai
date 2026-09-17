import { describe, expect, it } from 'vitest';
import { parserRepairOperations } from '../../n8n/parser-repair-compatibility.mjs';
const fixture = () => ({
  versionId: '4e2a3d14-b94b-40b3-b5c9-e930faa6ceb8',
  nodes: [
    { name: 'Analysis Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.3, parameters: { model: { value: 'fixture-model' }, builtInTools: {}, options: { timeout: 300000 } }, credentials: { openAiApi: { id: 'fixture', name: 'Fixture credential' } } },
    { name: 'Competitive Output Parser', parameters: { autoFix: true } },
  ],
});
describe('schema repair connection patch', () => {
  it('changes only the repair model connection and retains analysis settings and credentials', () => {
    const original = fixture(), before = structuredClone(original);
    const ops = parserRepairOperations(original);
    expect(original).toEqual(before);
    expect(ops).toHaveLength(3);
    expect(ops[0].node.parameters).toEqual({ model: { value: 'fixture-model' }, options: { timeout: 300000 }, responsesApiEnabled: false });
    expect(ops[0].node.credentials).toEqual(original.nodes[0].credentials);
    expect(ops[1]).toMatchObject({ type: 'removeConnection', source: 'Analysis Model', target: 'Competitive Output Parser' });
    expect(ops[2]).toMatchObject({ type: 'addConnection', source: 'Schema Repair Model', target: 'Competitive Output Parser' });
  });
  it('refuses a changed workflow version', () => {
    expect(() => parserRepairOperations({ ...fixture(), versionId: 'newer' })).toThrow('changed since parser QA');
  });
});
