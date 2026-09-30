import { defaultSproutCustomerId } from '../sprout/customer.ts';

type Period = {start:string;end:string};
export type OwnedProfile = {sprout_profile_id:number;network_type:string;native_name?:string;profile_name?:string;native_link?:string};
const DAY=86400000;
const day=(value:unknown)=>String(value || '').slice(0,10);
const number=(value:unknown):number|null=>value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;
import {ownedNetwork} from './ownedMerge.ts';
export {mergeOwnedCompetitivePosts} from './ownedMerge.ts';
const metric=(row:any,...keys:string[])=>keys.map(key=>number(row.metrics?.[key])).find(n=>n!==null) ?? null;
const sum=(values:(number|null)[])=>values.length && values.every(n=>n!==null) ? values.reduce<number>((a,b)=>a+b!,0) : null;
const previousPeriod=(period:Period)=>{
  if(![period.start,period.end].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)) throw new Error('Invalid competitive source dates');
  const days=Math.round((Date.parse(period.end)-Date.parse(period.start))/DAY)+1;
  if(!Number.isInteger(days)||days<1||days>366) throw new Error('Invalid competitive source period');
  return {start:new Date(Date.parse(period.start)-days*DAY).toISOString().slice(0,10),end:new Date(Date.parse(period.start)-DAY).toISOString().slice(0,10)};
};

/** Normalize all assigned owned profiles, never an agency-wide name search.
 * Public actions exclude private clicks, saves, IG shares, and YouTube shares
 * so the benchmark uses the same action definitions as competitor sources. */
export function normalizeOwnedCompetitive(profiles:OwnedProfile[],period:Period,postRows:any[],profileRows:any[],collectedAt:string) {
  const previous=previousPeriod(period);
  const ids=new Map(profiles.map(p=>[String(p.sprout_profile_id),p]));
  if(ids.size!==profiles.length) throw new Error('Duplicate assigned client profiles');
  const observations=new Map<string,any[]>();
  for(const row of profileRows) {
    const id=String(row.dimensions?.customer_profile_id || '');
    if(!ids.has(id)) throw new Error('Sprout audience belongs to an unassigned profile');
    const key=Object.keys(row.dimensions || {}).find(k=>k.startsWith('reporting_period'));
    const date=day(row.dimensions?.[key!]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Sprout audience date is missing');
    const rows=observations.get(id)||[]; rows.push({date,followers:metric(row,'lifetime_snapshot.followers_count')});observations.set(id,rows);
  }
  for(const profile of profiles) if(!observations.get(String(profile.sprout_profile_id))?.some(r=>r.followers!==null)) throw new Error('Sprout returned no profile coverage for '+(profile.profile_name||profile.native_name||profile.sprout_profile_id));
  const followers=(id:string,start:string,end:string)=>[...(observations.get(id)||[])].filter(r=>r.date>=start&&r.date<=end&&r.followers!==null).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const seen=new Set<string>(); const all:any[]=[];
  for(const row of postRows) {
    const id=String(row.customer_profile_id || row.dimensions?.customer_profile_id || '');
    const profile=ids.get(id);
    if(!profile) throw new Error('Sprout post belongs to an unassigned profile');
    const network=ownedNetwork(profile.network_type);
    if(row.network && ownedNetwork(row.network)!==network) throw new Error('Sprout post network does not match its assigned profile');
    if(row.sent===false) continue;
    if(/STORY|DIRECT_MESSAGE|COMMENT|REPLY|DARK|AD_POST/.test(String(row.post_type||''))) continue;
    const date=day(row.created_time);
    if(!date || !Number.isFinite(Date.parse(row.created_time)) || date<previous.start || date>period.end) throw new Error('Sprout post is outside the requested source period');
    const key=String(row.guid || row.perma_link || '');
    if(!key) throw new Error('Sprout post identity is missing');
    if(seen.has(key)) continue; seen.add(key);
    const applause=network==='instagram'||network==='youtube'||network==='twitter' ? metric(row,'lifetime.likes','lifetime.reactions') : metric(row,'lifetime.reactions','lifetime.likes');
    const conversation=metric(row,'lifetime.comments_count');
    const amplification=['instagram','youtube'].includes(network)?0:metric(row,'lifetime.shares_count','lifetime.post_shares_count');
    const engagement=sum([applause,conversation,amplification]);
    if(engagement===null) throw new Error('Sprout public engagement is incomplete for '+profile.profile_name+' on '+date);
    const audience=followers(id,previous.start,date);
    const media=(row.visual_media||[]).find((m:any)=>m.thumbnail_url||m.media_url);
    const category=String(row.content_category||'').toLowerCase();
    all.push({postId:'sprout:'+key,source:'sprout',source_profile_id:id,source_profile_name:profile.profile_name||profile.native_name,
      channel:network,publishedAt:row.created_time,message:String(row.text||''),postLink:row.perma_link||null,
      image:media?.thumbnail_url || (String(media?.media_type||'').toLowerCase().includes('video')?null:media?.media_url) || null,
      engagementTotal:engagement,applause,conversation,amplification,
      engagementRate:audience?.followers>0?engagement/audience.followers:null,presenceReach:audience?.followers??null,
      ownedImpressions:metric(row,'lifetime.impressions'),views:metric(row,'lifetime.video_views'),
      type:category==='album'||category==='document'?'carousel':category==='photo'?'image':category||'unknown',authorship:'company'});
  }
  const networks=[...new Set(profiles.map(p=>ownedNetwork(p.network_type)))];
  const summarize=(network:string,range:Period)=>{
    const selected=profiles.filter(p=>ownedNetwork(p.network_type)===network);
    const posts=all.filter(p=>p.channel===network&&day(p.publishedAt)>=range.start&&day(p.publishedAt)<=range.end);
    return {posts:posts.length,engagement:posts.reduce((n,p)=>n+p.engagementTotal,0),
      followers:sum(selected.map(p=>followers(String(p.sprout_profile_id),range.start,range.end)?.followers??null)),
      rate:posts.length && posts.every(p=>p.engagementRate!==null)?posts.reduce((n,p)=>n+p.engagementRate,0)/posts.length:null,
      impressions:posts.length?sum(posts.map(p=>p.ownedImpressions)):0};
  };
  const by_network:Record<string,any>=Object.fromEntries(networks.map(network=>{
    const current=summarize(network,period),before=summarize(network,previous);
    return [network,{...Object.fromEntries(Object.keys(current).map(k=>[k,{current:current[k as keyof typeof current],previous:before[k as keyof typeof before]}])),source:'sprout',impressions_kind:'actual',profiles:profiles.filter(p=>ownedNetwork(p.network_type)===network).map(p=>({id:String(p.sprout_profile_id),name:p.profile_name||p.native_name}))}];
  }));
  const snapshotDay=day(collectedAt);
  const audience_snapshot={by_network:Object.fromEntries(networks.map(network=>{
    const rows=profiles.filter(p=>ownedNetwork(p.network_type)===network).map(p=>followers(String(p.sprout_profile_id),new Date(Date.parse(snapshotDay)-2*DAY).toISOString().slice(0,10),snapshotDay));
    const dates=[...new Set(rows.filter(Boolean).map(r=>r.date))];
    return [network,{followers:dates.length===1?sum(rows.map(r=>r?.followers??null)):null,as_of:dates.length===1?dates[0]:null}];
  }))};
  return {provider:'sprout',coverage:'complete',period,previous_period:previous,collected_at:collectedAt,
    profiles:profiles.map(p=>({id:String(p.sprout_profile_id),name:p.profile_name||p.native_name,network:ownedNetwork(p.network_type)})),
    posts:all.filter(p=>day(p.publishedAt)>=period.start),metrics:{provider:'sprout',coverage:'complete',period,previous_period:previous,by_network,audience_snapshot}};
}

export async function collectOwnedCompetitive(db:any,client:any,period:Period) {
  const {data:profiles,error}=await db.from('sprout_profiles').select('sprout_profile_id,network_type,native_name,profile_name,native_link').eq('client_id',client.id).neq('is_active',false);
  if(error) throw new Error('Could not read assigned client profiles');
  // Sprout does not expose X consistently; RivalIQ remains the X source.
  const selected=(profiles||[]).filter((p:OwnedProfile)=>['facebook','instagram','linkedin','youtube','tiktok'].includes(ownedNetwork(p.network_type)));
  if(!selected.length) return {provider:'sprout',coverage:'not_connected',profiles:[],posts:[],metrics:null,period};
  if(selected.length>100) throw new Error('More than 100 profiles assigned to this client');
  const tokenResponse=await fetch('https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:(globalThis as any).Deno.env.get('SPROUT_CLIENT_ID')||'',client_secret:(globalThis as any).Deno.env.get('SPROUT_CLIENT_SECRET')||'',grant_type:'client_credentials',scope:'organization_id'}),signal:AbortSignal.timeout(15000),
  });
  if(!tokenResponse.ok) throw new Error('Sprout connection failed ['+tokenResponse.status+']');
  const {access_token:token}=await tokenResponse.json();
  if(!token) throw new Error('Sprout connection did not return a token');
  const customer=String(client.sprout_customer_id||defaultSproutCustomerId());
  const filter=`customer_profile_id.eq(${selected.map((p:OwnedProfile)=>p.sprout_profile_id).join(',')})`;
  const previous=previousPeriod(period);
  const collectedAt=new Date().toISOString(); const latest=day(collectedAt);
  const pages=async(path:string,body:any)=>{
    const rows:any[]=[];
    for(let page=1;page<=100;page++) {
      const response=await fetch(`https://api.sproutsocial.com/v1/${encodeURIComponent(customer)}/analytics/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,page}),signal:AbortSignal.timeout(20000)});
      if(!response.ok) {
        const detail=await response.text();
        throw new Error(`Sprout ${path} collection failed [${response.status}]: ${detail.replaceAll(token,'[redacted]').slice(0,600)}`);
      }
      const data=await response.json();
      if(!Array.isArray(data.data)||data.paging&&Number(data.paging.current_page)!==page) throw new Error('Sprout pagination response is incomplete');
      rows.push(...data.data);
      if(page>=Number(data.paging?.total_pages||1)) return rows;
    }
    throw new Error('Sprout source pagination limit exceeded');
  };
  const audience=async(range:Period)=>pages('profiles',{filters:[filter,`reporting_period.in(${range.start}...${range.end})`],metrics:['lifetime_snapshot.followers_count'],limit:1000});
  const [postRows,currentRows,previousRows,latestRows]=await Promise.all([
    pages('posts',{timezone:'UTC',filters:[filter,`created_time.in(${previous.start}T00:00:00...${period.end}T23:59:59)`],fields:['guid','customer_profile_id','network','created_time','perma_link','text','post_type','content_category','visual_media','sent'],metrics:['lifetime.reactions','lifetime.likes','lifetime.comments_count','lifetime.shares_count','lifetime.impressions','lifetime.video_views'],limit:50}),
    audience(period),audience(previous),audience({start:new Date(Date.parse(latest)-2*DAY).toISOString().slice(0,10),end:latest}),
  ]);
  return normalizeOwnedCompetitive(selected,period,postRows,[...currentRows,...previousRows,...latestRows],collectedAt);
}

