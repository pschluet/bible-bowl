/**
 * Application-level constants.
 * Kept in a separate file so client components can import them
 * without pulling in `@aws-amplify/backend` (CDK) into the browser bundle.
 */

/** The fixed DynamoDB record ID for the GameState singleton. */
export const GAME_STATE_ID = 'SINGLETON';
