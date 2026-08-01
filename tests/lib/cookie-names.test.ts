/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { jsCookieEncodeName } from '@/app/lib/cookie-names';

describe('jsCookieEncodeName', () => {
  it('leaves alphanumeric and dot/dash characters untouched', () => {
    expect(jsCookieEncodeName('CognitoIdentityServiceProvider.abc123.LastAuthUser')).toBe(
      'CognitoIdentityServiceProvider.abc123.LastAuthUser'
    );
  });

  it('re-decodes # $ & + ^ ` | back to their literal characters', () => {
    expect(jsCookieEncodeName('#')).toBe('#');
    expect(jsCookieEncodeName('$')).toBe('$');
    expect(jsCookieEncodeName('&')).toBe('&');
    expect(jsCookieEncodeName('+')).toBe('+');
    expect(jsCookieEncodeName('^')).toBe('^');
    expect(jsCookieEncodeName('`')).toBe('`');
    expect(jsCookieEncodeName('|')).toBe('|');
  });

  it('leaves @ percent-encoded as %40 (does not re-decode it)', () => {
    expect(jsCookieEncodeName('team-1@bible-bowl.internal')).toBe('team-1%40bible-bowl.internal');
  });

  it('encodes a full Amplify-style cookie name containing an @ in the username segment', () => {
    const raw = 'CognitoIdentityServiceProvider.clientid.team-1@bible-bowl.internal.accessToken';
    expect(jsCookieEncodeName(raw)).toBe(
      'CognitoIdentityServiceProvider.clientid.team-1%40bible-bowl.internal.accessToken'
    );
  });
});
