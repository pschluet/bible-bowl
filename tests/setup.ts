import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  // Only defined under the jsdom environment — route/pure-lib tests run
  // under `node` (see `// @vitest-environment node` docblocks) and have no
  // localStorage global at all.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
