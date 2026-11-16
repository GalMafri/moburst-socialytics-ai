import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
const f = vi.hoisted(() => ({
 verified: true, role: 'moburst_user' as string | null, hasSession: true, token: null as string | null,
 hubUserId: 'hub-1' as string | undefined, email: 'qa@example.test', source: 'gos' as string,
 getUserFailures: 0, getUserError: null as unknown, getSessionFailures: 0, getSessionError: null as unknown,
 setSession: vi.fn(), signOut: vi.fn(),
 signedOut: null as null | ((event: string) => void), unsubscribe: vi.fn(),
}));
vi.mock('@/utils/hubAuth', () => ({ initHubToken: () => f.token, clearHubToken: vi.fn(() => { f.token = null; }) }));
vi.mock('@/utils/gosAuth', () => ({ getGosHandoffToken: () => null, rememberPortal: vi.fn(), PORTAL_URL: 'https://fixture.invalid' }));
vi.mock('@/utils/returnTo', () => ({ rememberIntendedDestination: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
 auth: {
  getSession: async () => {
   if (f.getSessionFailures > 0) { f.getSessionFailures--; return { data: { session: null }, error: f.getSessionError }; }
   return { data: { session: f.hasSession ? { access_token: 'stored-token', user: { id: 'fixture', user_metadata: { tool_role: 'admin' } } } : null }, error: null };
  },
  signOut: async (...args: unknown[]) => { f.signOut(...args); return { error: null }; },
  getUser: async () => {
   if (f.getUserFailures > 0) { f.getUserFailures--; return { data: { user: null }, error: f.getUserError }; }
   return { data: { user: f.verified ? { id: 'fixture', email: f.email, user_metadata: { tool_role: 'admin', auth_source: f.source, hub_user_id: f.hubUserId, hub_company_name: 'Fixture' } } : null }, error: f.verified ? null : new Error('revoked') };
  },
  setSession: async (...args: unknown[]) => { f.setSession(...args); return { error: null }; },
  onAuthStateChange: (cb: (event: string) => void) => { f.signedOut = cb; return { data: { subscription: { unsubscribe: f.unsubscribe } } }; },
 },
 from: () => ({ select: () => ({ eq: async () => ({ data: f.role ? [{ role: f.role }] : [], error: null }) }) }),
} }));
import { AuthProvider, reconstructSession, useAuth } from '@/hooks/useAuth';
import { AUTH_ERROR_CODES } from '@/lib/authMessages';
function Status() { const a = useAuth(); return <div>{a.isAuthenticated ? `signed in:${a.userRole}` : 'signed out'}{a.authError ? ` error:${a.authError}` : ''}</div>; }
const network = () => Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
const hub = (over: Record<string, unknown> = {}) => ({ _id: 'hub-1', name: 'QA', email: 'qa@example.test', role: 'user', company: '', isActive: true, tools: [], createdAt: '', updatedAt: '', ...over });
let fetchMock: ReturnType<typeof vi.fn>;
const bridgeBodies = () => bridgeCalls().map(([, init]) => JSON.parse((init as { body: string }).body));
const bridgeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('hub-auth-bridge'));
function answer(meStatus: number, bridgeBody: unknown = { access_token: 'a', refresh_token: 'r', tool_role: 'moburst_user' }, hubBody: Record<string, unknown> = {}) {
 fetchMock.mockImplementation(async (url: string) => String(url).includes('/api/auth/me')
  ? { ok: meStatus === 200, status: meStatus, json: async () => hub(hubBody) }
  : { ok: true, status: 200, json: async () => bridgeBody });
}
beforeEach(() => {
 f.verified = true; f.role = 'moburst_user'; f.hasSession = true; f.token = null; f.hubUserId = 'hub-1'; f.email = 'qa@example.test'; f.source = 'gos';
 f.getUserFailures = 0; f.getUserError = null; f.getSessionFailures = 0; f.getSessionError = null; f.setSession.mockClear(); f.signOut.mockClear(); f.signedOut = null; f.unsubscribe.mockClear();
 fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
 vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('server-verified session recovery', () => {
 it('rejects a cached session that the auth server has revoked', async () => { f.verified = false; expect(await reconstructSession()).toBeNull(); });
 it('does not revive a removed role from stale admin metadata', async () => { f.role = null; expect(await reconstructSession()).toBeNull(); });
 it('uses the current database role instead of cached admin metadata', async () => { expect((await reconstructSession())?.role).toBe('moburst_user'); });
 it('removes signed-in controls after a sign-out event and unsubscribes', async () => {
  const view = render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  await act(async () => { f.signedOut?.('SIGNED_OUT'); });
  await waitFor(() => expect(screen.getByText(/^signed out/)).toBeInTheDocument());
  view.unmount(); expect(f.unsubscribe).toHaveBeenCalledOnce();
 });
});

describe('a failure that is not a sign-out', () => {
 it('keeps a valid session when the auth server does not answer once', async () => {
  f.getUserFailures = 1; f.getUserError = network();
  expect((await reconstructSession())?.role).toBe('moburst_user');
 });
 it('ends signed in when the first check fails with a network error and the next succeeds', async () => {
  f.getUserFailures = 1; f.getUserError = network();
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
 });
 it('does not report a session as signed out when the check keeps failing, it says it could not reach the service', async () => {
  f.getUserFailures = 99; f.getUserError = network();
  await expect(reconstructSession()).rejects.toBeTruthy();
 });
});

describe('a stored session the auth server cannot refresh just now', () => {
 it('retries getSession after a network failure and ends signed in', async () => {
  f.getSessionFailures = 1; f.getSessionError = network();
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
 });
 it('does not treat a getSession that keeps failing as signed out: it says it could not reach the service', async () => {
  f.getSessionFailures = 99; f.getSessionError = network();
  render(<AuthProvider><Status /></AuthProvider>);
  // (The test build shows the preview's dev user, so the check is the reason, not the word "signed out".)
  expect(await screen.findByText(/error:unreachable/)).toBeInTheDocument();
  expect(screen.queryByText(/moburst_user/)).toBeNull();
 });
 it('treats a getSession error that is not a network failure as no session', async () => {
  f.getSessionFailures = 1; f.getSessionError = Object.assign(new Error('Invalid Refresh Token'), { name: 'AuthApiError', status: 400 });
  expect(await reconstructSession()).toBeNull();
 });
});

describe('the legacy portal token', () => {
 beforeEach(() => { f.token = 'hub-token'; f.source = 'hub'; });
 it('asks the bridge on every load, sends it the stored access token and installs nothing when none comes back', async () => {
  answer(200, { tool_role: 'moburst_user' });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(bridgeBodies()).toEqual([{ hubToken: 'hub-token', accessToken: 'stored-token' }]);
  expect(f.setSession).not.toHaveBeenCalled();
 });
 it('ends signed out with "deactivated" when the Hub says the person is not active, and drops the stored session', async () => {
  answer(200, { error: 'deactivated' }, { isActive: false });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed out error:deactivated')).toBeInTheDocument();
  expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(f.setSession).not.toHaveBeenCalled();
 });
 it('ends with "no_access" for a stored client session when the Hub no longer grants the tool', async () => {
  f.role = 'client';
  answer(200, { error: 'no_access' });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed out error:no_access')).toBeInTheDocument();
  expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' });
 });
 it('uses the role the bridge answers with, so a staff member downgraded in the Hub is a client at once', async () => {
  answer(200, { tool_role: 'client' });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:client')).toBeInTheDocument();
 });
 it('asks the bridge when there is no stored session', async () => {
  f.hasSession = false; answer(200);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(bridgeCalls()).toHaveLength(1);
 });
 it('asks the bridge when the stored session belongs to someone else', async () => {
  f.hubUserId = 'someone-else'; answer(200);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(bridgeCalls()).toHaveLength(1);
 });
 it('drops a stale token and signs in from the stored session when the Hub answers 401', async () => {
  answer(401);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(bridgeCalls()).toHaveLength(0);
 });
 it('holds a reason code, never the bridge text, after the bridge refuses', async () => {
  f.hasSession = false; answer(200, { error: 'Could not assign your role (duplicate key value violates unique constraint)' });
  render(<AuthProvider><Status /></AuthProvider>);
  const text = (await screen.findByText(/error:/)).textContent || '';
  const code = text.split('error:')[1];
  expect(AUTH_ERROR_CODES as readonly string[]).toContain(code);
  expect(text).not.toMatch(/Bridge|Supabase|duplicate|role/);
 });
 it('says why when the bridge refuses a person, and does not let a stored session override it', async () => {
  answer(200, { error: 'no_access' }); f.hubUserId = 'someone-else';
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed out error:no_access')).toBeInTheDocument();
 });
});

describe('the Hub or the bridge cannot answer, which is not a refusal', () => {
 beforeEach(() => { f.token = 'hub-token'; f.source = 'hub'; });
 it('stays signed in on a valid stored session when the Hub answered the browser and the bridge then sees the Hub fail', async () => {
  answer(200, { error: 'portal_unreachable' });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(bridgeCalls()).toHaveLength(1);
  expect(f.signOut).not.toHaveBeenCalled();
 });
 it('stays signed in on a valid stored session when the Hub answers the browser with a 503, and keeps the token', async () => {
  answer(503);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  expect(f.token).toBe('hub-token');
  expect(f.signOut).not.toHaveBeenCalled();
 });
 it('says it could not reach the service, not that the sign-in expired, when the Hub is down and there is no stored session', async () => {
  f.hasSession = false; answer(429);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText(/error:unreachable/)).toBeInTheDocument();
  expect(f.token).toBe('hub-token');
 });
 it('drops the token and says expired when the Hub answers 403', async () => {
  f.hasSession = false; answer(403);
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText(/error:expired/)).toBeInTheDocument();
  expect(f.token).toBeNull();
 });
 it('does not sign out a stored session that belongs to someone else when this person is refused, it only drops the Hub token', async () => {
  f.email = 'someone.else@example.test';
  answer(200, { error: 'no_access' });
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed out error:no_access')).toBeInTheDocument();
  expect(f.signOut).not.toHaveBeenCalled();
  expect(f.token).toBeNull();
 });
});

describe('after a sign-out event', () => {
 it('signs in again when another sign-in arrives in the same tab', async () => {
  render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  await act(async () => { f.signedOut?.('SIGNED_OUT'); });
  await waitFor(() => expect(screen.getByText(/^signed out/)).toBeInTheDocument());
  await act(async () => { f.signedOut?.('SIGNED_IN'); });
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
 });
});
