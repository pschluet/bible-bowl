/**
 * A minimal in-memory stand-in for an Amplify Gen 2 generated data client
 * (`client.models.<Model>.{get,list,create,update,delete}`), used to test
 * API routes without a real AppSync backend.
 *
 * Usage in a route test file:
 *
 *   vi.mock('@aws-amplify/adapter-nextjs/data', async () => {
 *     const { createFakeDataClient } = await import('../support/amplify-mock');
 *     const client = createFakeDataClient();
 *     return {
 *       generateServerClientUsingCookies: () => client,
 *       generateServerClientUsingReqRes: () => client,
 *     };
 *   });
 *
 * The dynamic `import()` inside the factory avoids Vitest's restriction on
 * referencing outer-scope variables from a `vi.mock` factory. The test body
 * can then call `generateServerClientUsingCookies({} as never)` itself (the
 * real import, now mocked) to get back the same client instance for seeding
 * fixtures and asserting on store contents.
 */
import { vi } from 'vitest';

type FilterCondition = { eq?: unknown } | undefined;
type FilterExpr = { and?: FilterExpr[]; or?: FilterExpr[] } & Record<string, FilterCondition>;

/** Marker the reqRes-client mock's `contextSpec` must carry — see `pickPayload`. */
export const CONTEXT_SPEC_MARKER = '__isReqResContextSpec';

function isContextSpec(x: unknown): boolean {
  return typeof x === 'object' && x !== null && CONTEXT_SPEC_MARKER in x;
}

/**
 * Model methods are called in three different shapes across this codebase,
 * and all three must resolve to the SAME fake client instance in these
 * tests (see the module doc comment):
 *   - server "cookies" client (API routes): `(input)` — one argument.
 *   - server "reqRes" client (API routes): `(contextSpec, input)` — the
 *     first argument is a context object, tagged with CONTEXT_SPEC_MARKER by
 *     the mocked `runWithAmplifyServerContext` so it's identifiable here.
 *   - browser client (client components/pages): `(input, options)` — the
 *     *second* argument is an options bag like `{ authMode: 'userPool' }`,
 *     not the payload.
 * Arg count alone can't disambiguate reqRes from the browser client (both
 * pass 2 arguments), so this checks whether the first argument is a tagged
 * contextSpec rather than just checking `args.length`.
 */
function pickPayload<T>(args: unknown[]): T {
  if (args.length >= 2 && isContextSpec(args[0])) return args[1] as T;
  return args[0] as T;
}

function matchFilter<T extends Record<string, unknown>>(
  filter: FilterExpr | undefined
): (item: T) => boolean {
  if (!filter) return () => true;
  return (item: T): boolean => {
    if (filter.and) return filter.and.every((f) => matchFilter<T>(f)(item));
    if (filter.or) return filter.or.some((f) => matchFilter<T>(f)(item));
    return Object.entries(filter).every(([field, cond]) => {
      if (!cond || typeof cond !== 'object') return true;
      if ('eq' in cond) return item[field] === cond.eq;
      return true;
    });
  };
}

export interface FakeModelError {
  message: string;
}

export interface FakeModel<T extends Record<string, unknown>> {
  // Each method also accepts a leading `contextSpec` argument (reqRes-client
  // calling convention: `(contextSpec, input)`) — see `pickPayload` above.
  get: (
    key: Partial<T>,
    ...rest: unknown[]
  ) => Promise<{ data: T | null; errors?: FakeModelError[] }>;
  list: (opts?: {
    filter?: FilterExpr;
    nextToken?: string | null;
    limit?: number;
  }) => Promise<{ data: T[]; nextToken: string | null; errors?: FakeModelError[] }>;
  create: (input: T, ...rest: unknown[]) => Promise<{ data: T | null; errors?: FakeModelError[] }>;
  update: (
    input: Partial<T> & Record<string, unknown>,
    ...rest: unknown[]
  ) => Promise<{ data: T | null; errors?: FakeModelError[] }>;
  delete: (
    key: Partial<T>,
    ...rest: unknown[]
  ) => Promise<{ data: T | null; errors?: FakeModelError[] }>;
  /** Test-only: the underlying store, for seeding/inspecting fixtures directly. */
  _store: Map<string, T>;
  /** Test-only: clears the store and all call-count history between tests. */
  _reset: () => void;
  /** Test-only: force the next N create/update/delete calls to return an error. */
  _failNext: (method: 'create' | 'update' | 'delete', error: FakeModelError) => void;
}

function makeModel<T extends Record<string, unknown>>(pk: keyof T & string): FakeModel<T> {
  const store = new Map<string, T>();
  const pendingFailures: Partial<Record<'create' | 'update' | 'delete', FakeModelError>> = {};

  function consumeFailure(method: 'create' | 'update' | 'delete'): FakeModelError | null {
    const err = pendingFailures[method];
    if (err) delete pendingFailures[method];
    return err ?? null;
  }

  return {
    _store: store,
    _reset() {
      store.clear();
      delete pendingFailures.create;
      delete pendingFailures.update;
      delete pendingFailures.delete;
    },
    _failNext(method, error) {
      pendingFailures[method] = error;
    },
    get: vi.fn(async (...args: unknown[]) => {
      const key = pickPayload<Partial<T>>(args);
      const id = String(key[pk]);
      return { data: store.get(id) ?? null };
    }),
    list: vi.fn(async (...args: unknown[]) => {
      const opts = pickPayload<{ filter?: FilterExpr } | undefined>(args);
      const items = [...store.values()].filter(matchFilter<T>(opts?.filter));
      return { data: items, nextToken: null };
    }),
    create: vi.fn(async (...args: unknown[]) => {
      const input = pickPayload<T>(args);
      const failure = consumeFailure('create');
      if (failure) return { data: null, errors: [failure] };
      // Real Amplify auto-generates an id for fields like `id: a.id()` when
      // the caller omits it (e.g. Team/Score create calls in the app never
      // pass one). Without this, two omitted-id creates would both resolve
      // to the literal key "undefined" and collide.
      const rawId = input[pk];
      const id = rawId === undefined || rawId === null ? crypto.randomUUID() : String(rawId);
      const inputWithId = rawId === undefined || rawId === null ? { ...input, [pk]: id } : input;
      if (store.has(id)) {
        return { data: null, errors: [{ message: `Item with id ${id} already exists` }] };
      }
      const now = new Date().toISOString();
      const item = { createdAt: now, updatedAt: now, ...inputWithId } as T;
      store.set(id, item);
      return { data: item };
    }),
    update: vi.fn(async (...args: unknown[]) => {
      const input = pickPayload<Partial<T> & Record<string, unknown>>(args);
      const failure = consumeFailure('update');
      if (failure) return { data: null, errors: [failure] };
      const id = String(input[pk]);
      const existing = store.get(id);
      if (!existing) return { data: null, errors: [{ message: `Item with id ${id} not found` }] };
      const updated = { ...existing, ...input, updatedAt: new Date().toISOString() } as T;
      store.set(id, updated);
      return { data: updated };
    }),
    delete: vi.fn(async (...args: unknown[]) => {
      const key = pickPayload<Partial<T>>(args);
      const failure = consumeFailure('delete');
      if (failure) return { data: null, errors: [failure] };
      const id = String(key[pk]);
      const existing = store.get(id) ?? null;
      store.delete(id);
      return { data: existing };
    }),
  };
}

export interface FakeDataClient {
  models: {
    Game: FakeModel<Record<string, unknown>>;
    Team: FakeModel<Record<string, unknown>>;
    Score: FakeModel<Record<string, unknown>>;
    OnboardingToken: FakeModel<Record<string, unknown>>;
  };
  _resetAll: () => void;
}

export function createFakeDataClient(): FakeDataClient {
  const Game = makeModel('slug');
  const Team = makeModel('id');
  const Score = makeModel('id');
  const OnboardingToken = makeModel('tokenId');
  return {
    models: { Game, Team, Score, OnboardingToken },
    _resetAll() {
      Game._reset();
      Team._reset();
      Score._reset();
      OnboardingToken._reset();
    },
  };
}
