import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validateCompetitorWebsites } from '../../../supabase/functions/_shared/competitive/validateCompetitorWebsites';
beforeEach(()=>vi.stubGlobal('AbortSignal', { timeout: (ms:number) => { expect(ms).toBe(8000); return new AbortController().signal; } }));
afterEach(()=>vi.unstubAllGlobals());
const html='<html><head><title>Company</title></head><body>'+ 'Company information '.repeat(20)+'</body></html>';
it('excludes unreachable AI domains and duplicate companies while preserving candidate order',async()=>{
 const fetcher=vi.fn(async(url:string,init:any)=>{expect(init.signal).toBeDefined();if(url.includes('missing'))throw new TypeError('DNS failure');return new Response(html);});
 const r=await validateCompetitorWebsites([{name:'A',website_url:'https://a.example'},{name:'Missing',website_url:'https://missing.example'},{name:'Division of A',website_url:'https://www.a.example/path'},{name:'B',website_url:'https://b.example'}],undefined,fetcher as any);
 expect(r.verified.map(c=>c.name)).toEqual(['A','B']);expect(r.rejected.map(c=>c.name)).toEqual(['Missing','Division of A']);expect(r.rejected[0].reason).toMatch(/could not be reached/);
});
it('does not offer the client, an HTTP failure or an empty response as verified candidates',async()=>{
 const fetcher=vi.fn(async(url:string)=>url.includes('blocked')?new Response('',{status:403}):new Response(''));
 const r=await validateCompetitorWebsites([{name:'Client',website_url:'https://www.client.example'},{name:'Blocked',website_url:'https://blocked.example'},{name:'Empty',website_url:'https://empty.example'}],'https://client.example',fetcher as any);
 expect(r.verified).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(2);expect(r.rejected[1].reason).toContain('403');
});
