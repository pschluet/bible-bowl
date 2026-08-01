import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * `app/lib/auth.ts`, `app/lib/cognito.ts`, and every API route import
 * `@/amplify_outputs.json` at module scope. The real file is gitignored (and
 * contains live credentials), so under test that import resolves instead to
 * the committed, scrubbed `amplify_outputs.json.example` — same schema/shape,
 * placeholder secrets.
 *
 * A plain `resolve.alias` isn't enough here: Vite's built-in JSON plugin
 * transforms any module id ending in `.json` by re-running `JSON.parse` on
 * whatever the id resolves to, and `amplify_outputs.json.example` doesn't end
 * in `.json`. So this redirects the specifier to a virtual module (an id that
 * deliberately does NOT end in `.json`, so the JSON plugin leaves it alone)
 * and serves the `.example` file's contents as an ES module from there.
 */
function amplifyOutputsExamplePlugin(): Plugin {
  const examplePath = path.resolve(import.meta.dirname, 'amplify_outputs.json.example');
  const virtualId = '\0virtual:amplify-outputs';

  return {
    name: 'amplify-outputs-example',
    enforce: 'pre',
    resolveId(source) {
      if (source === '@/amplify_outputs.json' || source.endsWith('/amplify_outputs.json')) {
        return virtualId;
      }
      return null;
    },
    load(id) {
      if (id === virtualId) {
        return `export default ${fs.readFileSync(examplePath, 'utf-8')};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [amplifyOutputsExamplePlugin(), tsconfigPaths(), react()],
  test: {
    // jsdom is the default for components/pages. Route handler and pure-lib
    // tests opt into the `node` environment with a per-file
    // `// @vitest-environment node` docblock.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
