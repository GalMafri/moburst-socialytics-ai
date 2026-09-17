import React from 'react';
import { vi,it,expect,afterEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { PillarDerivationCard } from '@/components/onboarding/PillarDerivationCard';
import { mergeStrategySuggestions } from '@/lib/strategySuggestions';
const f=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:f.invoke}}}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
afterEach(()=>{cleanup();f.invoke.mockReset()});
it('keeps generated suggestions separate until Implement and Reject leaves existing data alone',async()=>{
 const derived=vi.fn();f.invoke.mockResolvedValue({data:{pillars:[{name:'Proposed',description:'New proposal'}],keywords:['new phrase']}});
 render(<PillarDerivationCard clientId='fixture' hasStrategyDoc hasBrief onDerived={derived}/>);
 fireEvent.click(screen.getByRole('button',{name:'Propose pillars and keywords'}));
 await screen.findByRole('region',{name:'AI suggestions — pending review'});
 expect(derived).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Re-do'}));await waitFor(()=>expect(f.invoke).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Reject'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Reject'}));
 expect(derived).not.toHaveBeenCalled();expect(screen.queryByText('New proposal')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Propose pillars and keywords'}));await screen.findByText('New proposal');fireEvent.click(screen.getByRole('button',{name:'Implement'}));expect(derived).toHaveBeenCalledTimes(1);
});
it('implementation preserves names, descriptions and keywords already entered',()=>{
 const existing=[{name:'Brand Story',description:'Manually approved description'}];
 const result=mergeStrategySuggestions(existing,['Marketing'],[{name:' brand story ',description:'AI overwrite'},{name:'Education',description:'New'}],[' marketing ','New term','NEW TERM']);
 expect(result).toEqual({content_pillars:[...existing,{name:'Education',description:'New'}],social_keywords:['Marketing','New term']});
});
