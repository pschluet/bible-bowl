/**
 * Hand-rolled stand-in for a `CognitoIdentityProviderClient`, used to test
 * routes that call `makeCognitoClient().send(new SomeCommand(...))`.
 *
 * Rather than mock the AWS SDK's client class, this mocks `@/app/lib/cognito`
 * (`makeCognitoClient`) directly and dispatches on the real command classes'
 * constructor name — the route under test still constructs real
 * `AdminGetUserCommand`/etc. instances (harmless; they're just plain data
 * objects with no network behavior of their own), so nothing about the
 * route's code needs to change for tests.
 *
 * Usage in a route test file:
 *
 *   vi.mock('@/app/lib/cognito', () => ({
 *     makeCognitoClient: vi.fn(),
 *     scorekeeperUsername: (teamId: string) => `team-${teamId}@bible-bowl.internal`,
 *     USER_POOL_ID: 'test-pool',
 *     SCOREKEEPER_EMAIL_DOMAIN: 'bible-bowl.internal',
 *   }));
 *
 *   const cognito = createFakeCognitoClient();
 *   vi.mocked(makeCognitoClient).mockReturnValue(cognito as never);
 */
import { vi } from 'vitest';

export interface CognitoCommandLike {
  constructor: { name: string };
  input: unknown;
}

export interface FakeCognitoClient {
  send: (command: CognitoCommandLike) => Promise<unknown>;
  calls: { command: string; input: unknown }[];
  /** Registers a success handler for a command, by class name (e.g. 'AdminGetUserCommand'). */
  on: (commandName: string, handler: (input: never) => unknown) => void;
  /** Registers a handler that throws — pass an Error with a `.name` to simulate AWS error codes. */
  onError: (commandName: string, error: unknown) => void;
}

export function createFakeCognitoClient(): FakeCognitoClient {
  const handlers = new Map<string, (input: never) => unknown>();
  const calls: { command: string; input: unknown }[] = [];

  const send = vi.fn(async (command: CognitoCommandLike) => {
    const name = command.constructor.name;
    calls.push({ command: name, input: command.input });
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`createFakeCognitoClient: no handler registered for ${name}`);
    }
    return handler(command.input as never);
  });

  return {
    send,
    calls,
    on(commandName, handler) {
      handlers.set(commandName, handler);
    },
    onError(commandName, error) {
      handlers.set(commandName, () => {
        throw error;
      });
    },
  };
}

/** Builds an error matching the shape routes check via `(err as {name?}).name`. */
export function cognitoError(name: string, message = name): Error & { name: string } {
  const err = new Error(message) as Error & { name: string };
  err.name = name;
  return err;
}
