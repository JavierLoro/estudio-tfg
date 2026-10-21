export const emptyContext = () => ({ rev: '0000000000000000', project: 'proyecto-ficticio', account: null,
  profile: { topic: '', objectives: '', scope: '', methodology: '', terminology: '', decisions: '', questions: '' },
  selection: { mode: 'off', scopes: [], folders: [], files: [], excluded: [] },
  grants: { prepareContext: false, useContext: false, prepareDiagrams: false, search: false },
  fragments: [], proposals: [], changed: { files: 0, words: 0, warn: false }, pending: 0, warnings: [], canUndo: false, effective: null });
