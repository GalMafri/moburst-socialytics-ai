import {referencesFor} from './designRefs.ts';
import type {CreativePlan} from './creativePlan.ts';
export async function loadCreativePlan(db:any, id:unknown, clientId:string, mode?:string) {
  if (typeof id !== 'string') throw new Error('Prepare a reference-backed creative direction before rendering.');
  const {data,error} = await db.from('creative_directions').select('*').eq('id',id).eq('client_id',clientId).single();
  if (error || !data || (mode && data.mode !== mode)) throw new Error('This creative direction does not belong to the requested client or format.');
  const {data:client,error:clientError} = await db.from('clients').select('design_references,harvested_design_references').eq('id',clientId).single();
  const owned = referencesFor(client?.design_references,client?.harvested_design_references,8);
  if(clientError || !Array.isArray(data.reference_paths) || data.reference_paths.some((p:unknown)=>typeof p!=='string'||!owned.includes(p))) throw new Error('Client references have changed. Prepare a new creative direction.');
  return {...data,plan:data.plan as CreativePlan,reference_paths:data.reference_paths as string[]};
}
