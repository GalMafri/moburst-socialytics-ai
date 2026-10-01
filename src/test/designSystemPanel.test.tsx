import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignSystemPanel } from '../components/onboarding/DesignSystemPanel';
import { currentSystems } from '../lib/designSystem';
const f = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: f.invoke } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const system = { version: 1, tokens: { font: { family: 'Poppins', body_weight: 400, casing: 'sentence' }, colors: { ink: '#ffffff', surface: '#101820', accent: '#3bd4ff', background: '#06080f', frame: ['#3bd4ff', '#bee545'] }, card: { style: 'glass', alpha: 0.6 }, frame: { style: 'gradient', width_pct: 0.4 }, logo: { asset_path: 'logos/c/v1.png', position: 'top-center', width_pct: { portrait: 28, square: 24, landscape: 16 } } }, imagery: { style: 'Dark depth, glass objects.', subjects: 'One object.', never: ['diagrams'] }, templates: [{ id: 'left-card', name: 'Headline left', formats: ['16:9'], hero: 'generated', headline: { region: 'left', width_pct: 48, max_lines: 4 }, hero_region: 'right', card: true, frame: true }, { id: 'bottom-card', name: 'Headline below', formats: ['4:5', '1:1'], hero: 'generated', headline: { region: 'bottom', width_pct: 100, max_lines: 3 }, hero_region: 'top', card: true, frame: true }], sources: [] };
const row = (over: Record<string, unknown>) => ({ id: 'ds-1', client_id: 'client-1', version: 1, status: 'draft', system, previews: [{ template_id: 'left-card', format: '16:9', path: 'p/1.png', url: 'https://x/1.png' }], built_from: [], logo_url: 'https://x/logo.png', approved_at: null, created_at: '2026-10-01T08:00:00Z', ...over });

it('offers to build only once the client has three branded posts', async () => {
  f.invoke.mockResolvedValue({ data: { systems: [] } });
  const view = render(<DesignSystemPanel clientId="client-1" referenceCount={2} />);
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('build-design-system', { body: { client_id: 'client-1', action: 'get' } }));
  expect(screen.getByRole('button', { name: /Build from posts/ })).toBeDisabled();
  expect(screen.getByText(/At least three branded posts/)).toBeInTheDocument();
  view.rerender(<DesignSystemPanel clientId="client-1" referenceCount={8} />);
  expect(screen.getByRole('button', { name: /Build from posts/ })).toBeEnabled();
});

it('builds a draft, shows its tokens and previews, and approves it', async () => {
  f.invoke.mockResolvedValueOnce({ data: { systems: [] } }).mockResolvedValueOnce({ data: { system: row({}) } }).mockResolvedValueOnce({ data: { system: row({ status: 'approved' }) } }).mockResolvedValueOnce({ data: { systems: [row({ status: 'approved', approved_at: '2026-10-01T08:05:00Z' })] } });
  render(<DesignSystemPanel clientId="client-1" referenceCount={8} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Build from posts/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Build from posts/ }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('build-design-system', { body: { client_id: 'client-1', action: 'build' } }));
  await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());
  expect(screen.getByText('Poppins')).toBeInTheDocument();
  expect(screen.getByAltText('Headline left preview')).toHaveAttribute('src', 'https://x/1.png');
  expect(screen.getByText('Headline below')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Approve v1/ }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('build-design-system', { body: { client_id: 'client-1', action: 'approve', id: 'ds-1' } }));
  await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
});

it('surfaces the server reason when a build fails', async () => {
  f.invoke.mockResolvedValueOnce({ data: { systems: [] } }).mockResolvedValueOnce({ data: { error: 'No usable logo was found in the posts and the client has no logo file.' } });
  render(<DesignSystemPanel clientId="client-1" referenceCount={5} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Build from posts/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Build from posts/ }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No usable logo was found'));
});

it('keeps the approved system current and shows only a newer draft beside it', () => {
  const approved = row({ id: 'a', status: 'approved', created_at: '2026-10-01T08:00:00Z' });
  const older = row({ id: 'o', status: 'draft', created_at: '2026-09-30T08:00:00Z' });
  const newer = row({ id: 'n', status: 'draft', version: 2, created_at: '2026-10-01T09:00:00Z' });
  expect(currentSystems([older, approved, newer] as any)).toEqual({ approved, draft: newer });
  expect(currentSystems([older, approved] as any)).toEqual({ approved, draft: null });
});
