import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {secretEquals} from '../_shared/auth/secretEquals.ts';
import {requireStaff} from '../_shared/auth/requireStaff.ts';
import {collectOwnedCompetitive} from '../_shared/competitive/ownedSource.ts';

Deno.serve(async req=>{
  if(req.method!=='POST') return Response.json({error:'POST required'},{status:405});
  try {
    const body=await req.json(); const clientId=String(body.client_id||'');
    if(!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(body.start||'') || !/^\d{4}-\d{2}-\d{2}$/.test(body.end||'')) return Response.json({error:'Client and source dates are required'},{status:400});
    if(!await secretEquals(req.headers.get('X-Socialytics-Secret'),Deno.env.get('SOCIALYTICS_N8N_SECRET'))) await requireStaff(req,{writeClientId:clientId});
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:client,error}=await db.from('clients').select('id,name,sprout_customer_id').eq('id',clientId).maybeSingle();
    if(error||!client) return Response.json({error:'Client not found'},{status:404});
    return Response.json({client_id:clientId,...await collectOwnedCompetitive(db,client,{start:body.start,end:body.end})});
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:'Owned source collection failed'},{status:typeof (error as any)?.status==='number'?(error as any).status:500});
  }
});
