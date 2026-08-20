import { describe, it, expect, vi } from 'vitest';
import { parseCookies, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from '../../src/server/cookie-utils';

describe('parseCookies', () => {
  it('returns an empty object for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('parses a single cookie', () => {
    expect(parseCookies('ragbuddy_session=abc123')).toEqual({ ragbuddy_session: 'abc123' });
  });

  it('parses multiple cookies separated by "; "', () => {
    expect(parseCookies('foo=bar; ragbuddy_session=abc123; baz=qux')).toEqual({
      foo: 'bar',
      ragbuddy_session: 'abc123',
      baz: 'qux',
    });
  });

  it('URL-decodes cookie values', () => {
    expect(parseCookies('ragbuddy_session=a%2Fb%3Dc')).toEqual({ ragbuddy_session: 'a/b=c' });
  });

  it('ignores malformed segments with no "="', () => {
    expect(parseCookies('malformed; ragbuddy_session=abc123')).toEqual({ ragbuddy_session: 'abc123' });
  });
});

describe('setSessionCookie / clearSessionCookie', () => {
  it('sets an HttpOnly session cookie with the given token', () => {
    const res = { setHeader: vi.fn() } as any;
    setSessionCookie(res, 'the-token');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringMatching(new RegExp(`^${SESSION_COOKIE_NAME}=the-token; HttpOnly; Path=/; SameSite=Lax; Max-Age=\\d+$`)),
    );
  });

  it('clears the session cookie with Max-Age=0', () => {
    const res = { setHeader: vi.fn() } as any;
    clearSessionCookie(res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    );
  });
});
