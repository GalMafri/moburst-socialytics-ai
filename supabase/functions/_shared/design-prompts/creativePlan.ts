/** A reference supplies a visual language, never a reusable finished advertisement. */
export interface CreativeFrame {
  headline: string;
  subject: string;
  composition: string;
  action: string;
  reference_indices: number[];
  layout?: {reference_index:number;headline_position:'top'|'bottom'|'left'|'right'|'center';subject_position:'top'|'bottom'|'left'|'right'|'background';logo_position:'top-left'|'top-center'|'top-right'};
}
export interface CreativePlan {
  brand_system: string;
  frames: CreativeFrame[];
  logo?: {reference_index:number;x:number;y:number;width:number;height:number};
  caption_style?: {color:string;surface:string;font_weight:number};
}
export function creativePlanSchema(count:number,references:number,video:boolean,previousHeadlinePosition?:string) {
  const text=(maxLength:number)=>({type:'string',description:`Nonempty; at most ${maxLength} characters.`});
  const index={type:'integer',enum:Array.from({length:references},(_,i)=>i)};
  const fraction={type:'number',description:'Fraction between 0 and 1 of the full original image.'};
  const layout={type:'object',additionalProperties:false,properties:{reference_index:index,headline_position:{type:'string',enum:['top','bottom','left','right','center'].filter(p=>p!==previousHeadlinePosition)},subject_position:{type:'string',enum:['top','bottom','left','right','background']},logo_position:{type:'string',enum:['top-left','top-center','top-right']}},required:['reference_index','headline_position','subject_position','logo_position']};
  return {type:'object',additionalProperties:false,properties:{
    brand_system:text(1800),
    frames:{type:'array',minItems:1,description:`Exactly ${count} frames.`,items:{type:'object',additionalProperties:false,properties:{headline:text(120),subject:text(700),composition:text(900),action:text(700),reference_indices:{type:'array',minItems:1,description:'Exactly two or three distinct owned reference indices.',items:index},...(!video?{layout}:{})},required:['headline','subject','composition','action','reference_indices',...(!video?['layout']:[])]}},
    logo:{type:'object',additionalProperties:false,properties:{reference_index:index,x:fraction,y:fraction,width:fraction,height:fraction},required:['reference_index','x','y','width','height']},
    ...(video?{caption_style:{type:'object',additionalProperties:false,properties:{color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},surface:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},font_weight:{type:'integer',enum:[400,700]}},required:['color','surface','font_weight']}}:{}),
  },required:['brand_system','frames','logo',...(video?['caption_style']:[])]};
}
const concise = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function parseCreativePlan(value: unknown, count: number, references: number, video = false): CreativePlan {
  const v = value as CreativePlan;
  if (!v || !concise(v.brand_system, 2500) || !Array.isArray(v.frames) || v.frames.length !== count) throw new Error('The creative plan was incomplete.');
  const subjects = new Set<string>(), compositions = new Set<string>();
  const layouts = new Set<string>();
  for (const f of v.frames) {
    if (!concise(f.headline, 120) || f.headline.trim().split(/\s+/).length > (video ? 9 : 14) || !concise(f.subject, 700) || !concise(f.composition, 900) || !concise(f.action, 700)) throw new Error('Each scene needs a concise message and a complete visual direction.');
    if (!Array.isArray(f.reference_indices) || f.reference_indices.length < 2 || f.reference_indices.length > 3 || new Set(f.reference_indices).size !== f.reference_indices.length || f.reference_indices.some(i => !Number.isInteger(i) || i < 0 || i >= references)) throw new Error('Each design must be grounded in two or three owned references.');
    subjects.add(f.subject.toLowerCase().trim()); compositions.add(f.composition.toLowerCase().trim());
    if (!video) {
      const l=f.layout;
      if(!l || !f.reference_indices.includes(l.reference_index) || !['top','bottom','left','right','center'].includes(l.headline_position) || !['top','bottom','left','right','background'].includes(l.subject_position) || !['top-left','top-center','top-right'].includes(l.logo_position)) throw new Error('Each design needs a measured layout from one of its selected client references.');
      layouts.add(`${l.headline_position}:${l.subject_position}`);
    }
  }
  if (subjects.size !== count || (count > 1 && compositions.size < Math.min(count, 3))) throw new Error('The plan repeats the same subject or composition.');
  if(!video && layouts.size<Math.min(count,3)) throw new Error('The plan repeats the same visual hierarchy. Use different layouts observed in the client references.');
  {
    const l=v.logo;
    if(!l||!Number.isInteger(l.reference_index)||l.reference_index<0||l.reference_index>=references||!['x','y','width','height'].every(k=>Number.isFinite(l[k as keyof typeof l]))||l.x<0||l.y<0||l.width<=0||l.height<=0||l.x+l.width>1||l.y+l.height>1||l.width*l.height>0.08) throw new Error('The authentic logo could not be located in the client references.');
  }
  if (video) {
    const c=v.caption_style;
    if(!c||!/^#[0-9a-f]{6}$/i.test(c.color)||!/^#[0-9a-f]{6}$/i.test(c.surface)||![400,700].includes(c.font_weight)) throw new Error('The reference typography could not be identified.');
  }
  return v;
}
/** The frame's references with its template first: the image model and the reviewer both read the first image as the template. */
export function frameReferenceIndices(f: CreativeFrame): number[] {
  if (!f.layout) return f.reference_indices;
  return [f.layout.reference_index, ...f.reference_indices.filter(i => i !== f.layout!.reference_index)];
}
export function creativeImagePrompt(plan: CreativePlan, index: number, correction = ''): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  return [
    'Create ONE new finished social graphic for this client. The attached images are the client\'s own published posts. They carry the brand tokens; take the tokens from the pixels, not from words: the exact colours and how much of the surface each one covers, the type family, weight contrast, casing and letter spacing, the headline surfaces (glass or frosted cards, panels, pills), frames and borders, light effects, materials and textures, and the way hero objects are rendered and lit.',
    'Build a NEW composition with those tokens. Do not reproduce any attached layout, subject, photograph, person, product, campaign text or quote. Equally, do not strip the brand away into a generic scene: the headline must use the brand\'s typography and the brand\'s headline surface, and at least one recurring device seen across the references (card, frame, border, glow, signature 3-D material) must be present. A design that would pass as a stock render with a logo on it is wrong; so is a design that copies a reference with new words.',
    `Recurring brand vocabulary observed in the references: ${plan.brand_system}`,
    `New subject for this post: ${f.subject}`,
    f.layout ? `Hierarchy for this design: headline in the ${f.layout.headline_position} region, subject in the ${f.layout.subject_position} region. The PRIMARY layout reference for type weight and spacing is attached image ${f.reference_indices.indexOf(f.layout.reference_index)+1}; match its typography treatment, not its arrangement or subject.` : `Composition for this design: ${f.composition}`,
    `Exact headline: ${JSON.stringify(f.headline)}. These are the only visible words. Preserve spelling and sentence case. Match the references\' regular/bold contrast; never make every word heavy bold.`,
    'One edge-to-edge composition, no contact sheet, mock social interface, slide counter, empty text card, blank placeholder or extra captions. Do not invent people, endorsements, statistics or product claims.',
    plan.logo ? `Render NO logo, wordmark, brand name or substitute icon. Leave breathing room at ${f.layout?.logo_position || 'top-center'} for software to place the real client logo: its footprint is 22% of image width and 8% of image height, starting 4.5% from the top. Keep headline and subject clear of that footprint. Continue the scene backdrop naturally behind this space; do not draw any header band, strip, panel, border, rectangle or placeholder for the logo.` : 'Match the authentic logo in the supplied images precisely; never invent a replacement mark.',
    correction ? `Correct the previous attempt: ${correction.slice(0, 1600)}` : '',
  ].filter(Boolean).join('\n\n');
}
export function creativeVideoPrompt(plan: CreativePlan): string {
  return [
    'Produce a 12-second film with three distinct shots and purposeful subject movement. The attached real client posts are STYLE REFERENCES only. Do not animate those cards, hold a poster, zoom a still, or turn them into a slideshow. Create a new moving scene for each shot.',
    `Use the photographic/illustration treatment, palette, materials, visual effects and lighting visibly supported by the ACTUAL attached references. This description is secondary evidence; ignore all static card, logo and text-layout directions in it: ${plan.brand_system}`,
    ...plan.frames.map((f, i) => `SHOT ${i + 1}, ${i * 4}-${(i + 1) * 4}s: ${f.subject}. ACTION: ${f.action}. `),
    'Cut between the three different shots at 4 and 8 seconds. Show visible action throughout each shot, with depth and temporal progression. No repeated opening frame. No static headline cards, frozen posters or crossfades between still images.',
    'Render no lettering, subtitles, numbers, logos, watermarks, interfaces or text containers. The application adds exact timed typography and the authentic client logo afterwards. Keep the lower quarter relatively calm for that typography. Never use a client logo, icon or wordmark as a 3-D scene subject. No invented claims, portraits or testimonials.',
  ].join('\n\n');
}
