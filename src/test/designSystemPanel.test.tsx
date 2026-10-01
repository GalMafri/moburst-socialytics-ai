import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignSystemPanel } from '../components/onboarding/DesignSystemPanel';
const f = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: f.invoke }, storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }) }) } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const tpl = { id: 't1', name: 'Layout 1', source_path: 'c/post1.jpg', score: 0.84, width: 1080, height: 1350, format: '4:5', slots: [{ role: 'headline', x: 0, y: 0, w: 1, h: 1, size: 52, maxLines: 4, align: 'center', weight: 400, color: '#fff', sample: 'x' }], hero: { role: 'hero', x: 0, y: 0, w: 1080, h: 1350 }, preview_url: 'https://x/preview1.png' };
const building = { queue: ['c/post2.jpg'], done: false, templates: [tpl], rejected: [], faces: { Poppins: 1 }, logo_url: null, current: { path: 'c/post2.jpg', round: 1, score: 0.5 }, progress: { kept: 1, rejected: 0, remaining: 2, current: { path: 'c/post2.jpg', round: 1, score: 0.5 } } };
const finished = { ...building, queue: [], done: true, current: null, progress: { kept: 1, rejected: 0, remaining: 0, current: null } };
const route = (handlers: Record<string, (body: any) => any>) => f.invoke.mockImplementation(async (fn: string, { body }: any) => ({ data: handlers[`${fn}:${body.action}`]?.(body) ?? { systems: [] } }));

it('explains the build and withholds it until the client has three posts', async () => {
  route({ 'build-social-templates:get': () => ({ id: null, build: null }), 'build-design-system:get': () => ({ systems: [] }) });
  render(<DesignSystemPanel clientId="client-1" referenceCount={2} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Build from posts/ })).toBeDisabled());
  expect(screen.getByText(/At least three branded posts/)).toBeInTheDocument();
});

it('starts a build, steps it until done, shows each template next to its post, and approves', async () => {
  let steps = 0;
  route({
    'build-social-templates:get': () => ({ id: null, build: null }),
    'build-design-system:get': () => ({ systems: [] }),
    'build-social-templates:start': () => ({ id: 'b1', build: building }),
    'build-social-templates:step': () => ({ id: 'b1', build: ++steps >= 2 ? finished : building }),
    'build-social-templates:approve': () => ({ approved: 'b1', templates: 1 }),
  });
  render(<DesignSystemPanel clientId="client-1" referenceCount={6} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Build from posts/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Build from posts/ }));
  await waitFor(() => expect(screen.getByText('Ready to approve')).toBeInTheDocument());
  expect(steps).toBe(2);
  expect(screen.getByAltText('Layout 1: the client’s post')).toHaveAttribute('src', 'https://x/c/post1.jpg');
  expect(screen.getByAltText('Layout 1: the template as rendered')).toHaveAttribute('src', 'https://x/preview1.png');
  expect(screen.getByText('84% match')).toBeInTheDocument();
  expect(screen.getByText('Poppins')).toBeInTheDocument();
  route({ 'build-social-templates:approve': () => ({ approved: 'b1', templates: 1 }), 'build-social-templates:get': () => ({ id: 'b1', build: finished }), 'build-design-system:get': () => ({ systems: [{ id: 'b1', status: 'approved' }] }) });
  fireEvent.click(screen.getByRole('button', { name: /Approve 1 templates/ }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('build-social-templates', { body: { client_id: 'client-1', action: 'approve', id: 'b1' } }));
  await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
});

it('resumes stepping a build that was left unfinished', async () => {
  route({ 'build-social-templates:get': () => ({ id: 'b1', build: building }), 'build-design-system:get': () => ({ systems: [] }), 'build-social-templates:step': () => ({ id: 'b1', build: finished }) });
  render(<DesignSystemPanel clientId="client-1" referenceCount={6} />);
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('build-social-templates', { body: { client_id: 'client-1', action: 'step' } }));
  await waitFor(() => expect(screen.getByText('Ready to approve')).toBeInTheDocument());
});

it('surfaces the server reason when a step fails', async () => {
  route({ 'build-social-templates:get': () => ({ id: null, build: null }), 'build-design-system:get': () => ({ systems: [] }), 'build-social-templates:start': () => ({ error: 'Connect this client’s social profiles in Client Setup to discover at least three real brand posts first.' }) });
  render(<DesignSystemPanel clientId="client-1" referenceCount={5} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Build from posts/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Build from posts/ }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connect this client'));
});
