/**
 * Mirrors the encoding that Amplify's js-cookie adapter applies to cookie
 * names. Characters like `@` in the username become `%40` in the cookie
 * name on the wire.
 * Source: node_modules/@aws-amplify/adapter-nextjs/dist/cjs/utils/cookie/ensureEncodedForJSCookie.js
 *
 * Shared between the server-side session reader (`app/lib/auth.ts`) and the
 * manual load-test script (`scripts/test-scorekeepers.ts`), which both need
 * to reconstruct the exact cookie names Amplify's client SDK writes.
 */
export function jsCookieEncodeName(name: string): string {
  return encodeURIComponent(name).replace(/%(2[346B]|5E|60|7C)/gi, decodeURIComponent);
}
