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
export function creativeImagePrompt(plan: CreativePlan, index: number, correction = ''): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  return [
    'Create ONE new finished client social graphic. The attached images are real published client references. Study their actual visual treatment, typography, palette, spacing and authentic logo. They are visual evidence, not canvases to repaint.',
    `Reference-backed brand system: ${plan.brand_system}`,
    `New subject for this post: ${f.subject}`,
    `Composition for this particular design: ${f.composition}`,
    f.layout ? `The PRIMARY layout reference is attached image ${f.reference_indices.indexOf(f.layout.reference_index)+1}. Match its typography weight, hierarchy and spacing. Headline: ${f.layout.headline_position}; new subject: ${f.layout.subject_position}. Other references support color and image treatment, not a merged generic card layout.` : '',
    `Exact headline: ${JSON.stringify(f.headline)}. These are the only visible words. Preserve spelling and sentence case. Match the actual reference's regular/bold contrast; never make every word heavy bold.`,
    'Create new imagery appropriate to this message. Never reuse a reference photograph, face, campaign prop, product, quote or headline. Never just change the text on a reference. Retain the real brand identity and design treatment, while changing the subject, visual hierarchy and arrangement as directed. Do not invent people, endorsements, statistics or product claims.',
    'One edge-to-edge composition, no contact sheet, mock social interface, slide counter or extra captions. Exclude incidental gems, crystals, leaves and other decorations unless they are the specified subject. The reference brand system describes evidence, not a checklist of props to add.',
    plan.logo ? `Render NO logo, wordmark, brand name or substitute icon. Reserve the FULL top 17% of the frame as a calm, plain identity band with no lettering or subject. Keep the headline entirely below it. Software places the authentic logo pixels at ${f.layout?.logo_position || 'top-center'} in that band afterwards.` : 'Match the authentic logo in the supplied images precisely; never invent a replacement mark.',
    correction ? `Correct the previous attempt: ${correction.slice(0, 1600)}` : '',
  ].filter(Boolean).join('\n\n');
}
export function creativeVideoPrompt(plan: CreativePlan): string {
  return [
    'Produce a 12-second film with three distinct shots and purposeful subject movement. The attached real client posts are STYLE REFERENCES only. Do not animate those cards, hold a poster, zoom a still, or turn them into a slideshow. Create a new moving scene for each shot.',
    `Use the photographic/illustration treatment, palette and lighting visibly supported by these references: ${plan.brand_system}`,
    ...plan.frames.map((f, i) => `SHOT ${i + 1}, ${i * 4}-${(i + 1) * 4}s: ${f.subject}. ACTION: ${f.action}. CAMERA/COMPOSITION: ${f.composition}.`),
    'Cut between the three different shots at 4 and 8 seconds. Show visible action throughout each shot, with depth and temporal progression. No repeated opening frame. No static headline cards, frozen posters or crossfades between still images.',
    'Render no lettering, subtitles, numbers, logos, watermarks, interfaces or text containers. The application adds exact timed typography and the authentic client logo afterwards. Keep the lower quarter relatively calm for that typography. No invented claims, portraits or testimonials.',
  ].join('\n\n');
}
