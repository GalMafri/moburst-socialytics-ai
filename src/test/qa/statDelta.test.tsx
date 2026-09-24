import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { StatCard } from '@/components/ui/stat-card';
afterEach(cleanup);
it.each([[-4/9336*100,'-0.043%'],[0,'0%'],[0.003,'+0.003%']])('shows %s percent without presenting a small change as signed zero', (percent,label)=>{
  render(<StatCard label="Followers" value="9,332" delta={{percent}}/>);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText('-0%')).toBeNull();expect(screen.queryByText('+0%')).toBeNull();
});
