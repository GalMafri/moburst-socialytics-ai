// The one place opentype.js is imported. esm.sh serves the package as a
// CommonJS bundle (parse is on its default export) and its types as named
// exports (no default), so the module is read as a namespace and the default
// is taken when the bundle has one. Both shapes then type-check and run.
import * as namespace from 'https://esm.sh/opentype.js@1.3.4';

export const opentype: typeof namespace = (namespace as unknown as { default?: typeof namespace }).default ?? namespace;
