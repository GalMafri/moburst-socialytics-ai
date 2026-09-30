export const ownedNetwork=(value:unknown)=>({fb_instagram_account:'instagram',linkedin_company:'linkedin',x:'twitter'}[String(value).toLowerCase()] || String(value).toLowerCase());

/** Replace duplicate public-source copies only on networks actually collected
 * through the client's assigned profiles. Other client networks are retained. */
export function mergeOwnedCompetitivePosts(existing:any[],owned:any,company:{id:string;name:string}) {
  if(owned?.coverage!=='complete') return existing;
  const networks=new Set(owned.profiles.map((p:any)=>p.network));
  const publicOwn=existing.filter(p=>String(p.companyId)===String(company.id));
  const keep=existing.filter(p=>String(p.companyId)!==String(company.id)||!networks.has(ownedNetwork(p.channel)));
  const mediaFor=(post:any)=>publicOwn.find(p=>p.postLink&&p.postLink===post.postLink)?.image;
  return [...keep,...owned.posts.map((post:any)=>({...post,companyId:String(company.id),companyName:company.name,image:post.image||mediaFor(post)||null}))];
}
