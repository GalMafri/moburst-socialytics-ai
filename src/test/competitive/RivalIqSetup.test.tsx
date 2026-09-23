import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RivalIqSetup } from '@/components/competitive/RivalIqSetup';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@/lib/invokeError', () => ({ describeInvokeError: async (e: any, data: any) => data?.error || e?.message }));
const preview = { fingerprint:'hash', plan: { companies: [{id:'client',name:'Client',url:'https://client.com/'},{id:'rival',name:'Rival',url:'https://rival.com/'}] }, job: null };
afterEach(cleanup);
beforeEach(() => mocks.invoke.mockReset());
describe('reviewed provider setup', () => {
 it('only previews until the reviewed connect button is pressed', async () => {
  mocks.invoke.mockResolvedValue({ data:preview });
  render(<RivalIqSetup setId="set" onComplete={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:'Set up RivalIQ tracking'}));
  await screen.findByText('https://client.com/');
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke.mock.calls[0][1].body.mode).toBe('preview');
  expect(screen.getByRole('button',{name:'Connect these companies'})).toBeEnabled();
 });
 it('continues durable steps and stops when the provider is pending', async () => {
  mocks.invoke.mockResolvedValueOnce({data:preview}).mockResolvedValueOnce({data:{job:{phase:'created'}}}).mockResolvedValueOnce({data:{job:{phase:'following'}}});
  render(<RivalIqSetup setId="set" onComplete={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:'Set up RivalIQ tracking'}));
  fireEvent.click(await screen.findByRole('button',{name:'Connect these companies'}));
  await screen.findByRole('button',{name:'Check status'});
  expect(mocks.invoke).toHaveBeenCalledTimes(3);
  expect(mocks.invoke.mock.calls[1][1].body.fingerprint).toBe('hash');
 });
 it('reads status after a lost response and never repeats a POST automatically', async () => {
  mocks.invoke.mockResolvedValueOnce({data:preview}).mockRejectedValueOnce(Error('Response lost')).mockResolvedValueOnce({data:{...preview,job:{phase:'create_requested'}}});
  render(<RivalIqSetup setId="set" onComplete={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:'Set up RivalIQ tracking'}));
  fireEvent.click(await screen.findByRole('button',{name:'Connect these companies'}));
  await screen.findByText('Response lost');
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(3));
  expect(mocks.invoke.mock.calls.map(c=>c[1].body.mode)).toEqual(['preview','advance','preview']);
 });
});
