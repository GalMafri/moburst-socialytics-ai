import { loadImage } from './composeText';
import type { EditRegion } from '../../supabase/functions/_shared/design-prompts/referenceTemplate';

/** Original social artwork is the canvas. Only bounded campaign-copy pixels may change. */
export async function applyReferenceTemplate(sourceUrl:string, editedUrl:string, regions:EditRegion[]):Promise<string> {
  if (!regions.length || regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1||r.y+r.height>1)||regions.reduce((a,r)=>a+r.width*r.height,0)>0.35) throw new Error('Invalid client template edit regions.');
  const [source,edit]=await Promise.all([loadImage(sourceUrl),loadImage(editedUrl)]);
  const canvas=document.createElement('canvas');
  canvas.width=source.naturalWidth; canvas.height=source.naturalHeight;
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('Cannot compose the client template.');
  ctx.drawImage(source,0,0);
  for(const r of regions){
    const x=Math.round(r.x*canvas.width),y=Math.round(r.y*canvas.height),w=Math.round(r.width*canvas.width),h=Math.round(r.height*canvas.height);
    ctx.drawImage(edit,r.x*edit.naturalWidth,r.y*edit.naturalHeight,r.width*edit.naturalWidth,r.height*edit.naturalHeight,x,y,w,h);
  }
  return canvas.toDataURL('image/png');
}
