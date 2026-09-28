import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
const f = vi.hoisted(() => ({ verified: true, role: 'moburst_user' as string | null, signedOut: null as null | ((event: string) => void), unsubscribe: vi.fn() }));
vi.mock('@/utils/hubAuth', () => ({ initHubToken: () => null, clearHubToken: vi.fn() }));
vi.mock('@/utils/gosAuth', () => ({ getGosHandoffToken: () => null, PORTAL_URL: 'https://fixture.invalid' }));
vi.mock('@/utils/returnTo', () => ({ rememberIntendedDestination: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
 auth: {
  getSession: async () => ({ data: { session: { user: { id: 'fixture', user_metadata: { tool_role: 'admin' } } } } }),
  getUser: async () => ({ data: { user: f.verified ? { id: 'fixture', email: 'qa@example.test', user_metadata: { tool_role: 'admin', auth_source: 'gos', hub_company_name: 'Fixture' } } : null }, error: f.verified ? null : new Error('revoked') }),
  onAuthStateChange: (cb: (event: string) => void) => { f.signedOut = cb; return { data: { subscription: { unsubscribe: f.unsubscribe } } }; },
 },
 from: () => ({ select: () => ({ eq: async () => ({ data: f.role ? [{ role: f.role }] : [], error: null }) }) }),
} }));
import { AuthProvider, reconstructSession, useAuth } from '@/hooks/useAuth';
function Status() { const a = useAuth(); return <div>{a.isAuthenticated ? `signed in:${a.userRole}` : 'signed out'}</div>; }
beforeEach(() => { f.verified = true; f.role = 'moburst_user'; f.signedOut = null; f.unsubscribe.mockClear(); });
afterEach(cleanup);
describe('server-verified session recovery', () => {
 it('rejects a cached session that the auth server has revoked', async () => { f.verified = false; expect(await reconstructSession()).toBeNull(); });
 it('does not revive a removed role from stale admin metadata', async () => { f.role = null; expect(await reconstructSession()).toBeNull(); });
 it('uses the current database role instead of cached admin metadata', async () => { expect((await reconstructSession())?.role).toBe('moburst_user'); });
 it('removes signed-in controls after a sign-out event and unsubscribes', async () => {
  const view = render(<AuthProvider><Status /></AuthProvider>);
  expect(await screen.findByText('signed in:moburst_user')).toBeInTheDocument();
  await act(async () => { f.signedOut?.('SIGNED_OUT'); });
  await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
  view.unmount(); expect(f.unsubscribe).toHaveBeenCalledOnce();
 });
});
