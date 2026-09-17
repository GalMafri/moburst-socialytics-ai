/** Keep analysis settings intact; give schema repair a string-content model response. */
export function parserRepairOperations(workflow) {
  const expected = '4e2a3d14-b94b-40b3-b5c9-e930faa6ceb8';
  if (workflow.versionId !== expected) throw new Error('Competitive workflow changed since parser QA; rebase before applying');
  const model = workflow.nodes.find(node => node.name === 'Analysis Model');
  const parser = workflow.nodes.find(node => node.name === 'Competitive Output Parser');
  if (!model || !parser || !parser.parameters.autoFix) throw new Error('Expected analysis model and repairing parser');
  if (workflow.nodes.some(node => node.name === 'Schema Repair Model')) throw new Error('Repair model already exists');
  const parameters = structuredClone(model.parameters);
  parameters.responsesApiEnabled = false;
  delete parameters.builtInTools;
  const repair = {
    name: 'Schema Repair Model',
    type: model.type,
    typeVersion: model.typeVersion,
    parameters,
    credentials: structuredClone(model.credentials),
    position: [(model.position?.[0] || 0) + 300, (model.position?.[1] || 0) + 160],
    notes: 'Dedicated schema-repair model. Chat Completions returns string content compatible with the n8n fixing parser. Analysis Model stays unchanged. Verified using a recorded malformed Bader completion.',
  };
  const connection = { target: parser.name, connectionType: 'ai_languageModel', sourceIndex: 0, targetIndex: 0 };
  return [
    { type: 'addNode', node: repair },
    { type: 'removeConnection', source: model.name, ...connection },
    { type: 'addConnection', source: repair.name, ...connection },
  ];
}
