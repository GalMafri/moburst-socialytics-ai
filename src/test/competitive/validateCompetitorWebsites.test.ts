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
it('does not offer the client, a missing page, a server failure or an empty response as verified candidates',async()=>{
 const fetcher=vi.fn(async(url:string)=>url.includes('gone')?new Response('',{status:404}):url.includes('down')?new Response('',{status:502}):new Response(''));
 const r=await validateCompetitorWebsites([{name:'Client',website_url:'https://www.client.example'},{name:'Gone',website_url:'https://gone.example'},{name:'Down',website_url:'https://down.example'},{name:'Empty',website_url:'https://empty.example'}],'https://client.example',fetcher as any);
 expect(r.verified).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(3);expect(r.rejected[1].reason).toContain('404');expect(r.rejected[2].reason).toContain('502');
});
it('keeps a company whose website exists but refuses automated visitors (403, 429), as Shopify storefronts do',async()=>{
 const fetcher=vi.fn(async(url:string)=>url.includes('rate')?new Response('',{status:429}):url.includes('forbid')?new Response('',{status:403}):new Response(html));
 const r=await validateCompetitorWebsites([{name:'Rate limited',website_url:'https://rate.example'},{name:'Forbidden',website_url:'forbid.example'},{name:'Open',website_url:'https://open.example'}],undefined,fetcher as any);
 expect(r.verified.map(c=>c.name)).toEqual(['Rate limited','Forbidden','Open']);expect(r.verified[1].website_url).toBe('https://forbid.example/');expect(r.rejected).toEqual([]);
});
