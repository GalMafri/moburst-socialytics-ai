import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LogoFileField } from '../components/onboarding/LogoFileField';
const f = vi.hoisted(() => ({ upload: vi.fn(), publicUrl: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { storage: { from: () => ({ upload: f.upload, getPublicUrl: f.publicUrl }) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('uploads a PNG to the public bucket and hands back its public URL', async () => {
  f.upload.mockResolvedValue({ error: null });
  f.publicUrl.mockReturnValue({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/generated-media/client-1/logo-1.png' } });
  const onChange = vi.fn();
  render(<LogoFileField clientId="client-1" clientName="Moburst" logoUrl="" onChange={onChange} />);
  expect(screen.getByText('Click to upload the logo file')).toBeInTheDocument();
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('logo-file-input'), { target: { files: [file] } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/public/generated-media/client-1/logo-1.png'));
  expect(f.upload.mock.calls[0][0]).toMatch(/^client-1\/logo-\d+\.png$/);
});

it('rejects a file that is not an image and keeps the current logo', async () => {
  const onChange = vi.fn();
  render(<LogoFileField clientId="client-1" clientName="Moburst" logoUrl="" onChange={onChange} />);
  const file = new File(['%PDF'], 'book.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByTestId('logo-file-input'), { target: { files: [file] } });
  await waitFor(() => expect(f.upload).not.toHaveBeenCalled());
  expect(onChange).not.toHaveBeenCalled();
});

it('shows the logo on file with replace and remove', () => {
  const onChange = vi.fn();
  render(<LogoFileField clientId="client-1" clientName="Moburst" logoUrl="https://x/logo.png" onChange={onChange} />);
  expect(screen.getByAltText('Moburst logo')).toHaveAttribute('src', 'https://x/logo.png');
  expect(screen.getByRole('button', { name: /Replace/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove logo file' }));
  expect(onChange).toHaveBeenCalledWith('');
});
