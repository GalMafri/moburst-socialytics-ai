import {loadImage} from './composeText';
import type {ProductionPlan} from './creativeProduction';

/** Keep complete connected strokes, but exclude decorations caught by crop padding. */
export function retainLogoComponents(data:Uint8ClampedArray,width:number,height:number,core:{left:number;top:number;right:number;bottom:number}) {
  const seen=new Uint8Array(width*height);
  for(let start=0;start<seen.length;start++) {
    if(seen[start]||data[start*4+3]<=16) continue;
    const queue=[start],component:number[]=[];seen[start]=1;let touchesLogo=false;
    for(let i=0;i<queue.length;i++) {
      const at=queue[i],x=at%width,y=Math.floor(at/width);component.push(at);
      if(x>=core.left&&x<=core.right&&y>=core.top&&y<=core.bottom) touchesLogo=true;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy,next=ny*width+nx;
        if(nx<0||ny<0||nx>=width||ny>=height||seen[next]||data[next*4+3]<=16) continue;
        seen[next]=1;queue.push(next);
      }
    }
    if(!touchesLogo) for(const at of component) data[at*4+3]=0;
  }
}

/** Remove only the uniform edge-connected backdrop around an authentic lockup. */
export function sourceLogo(image:HTMLImageElement,box:NonNullable<ProductionPlan['logo']>):HTMLCanvasElement {
  // Vision bounds are approximate. Include a safety margin, then trim the
  // transparent backdrop; this retains low wordmark baselines and icon tips.
  const x=Math.max(0,box.x-0.08),y=Math.max(0,box.y-0.08);
  const width=Math.min(1,box.x+box.width+0.08)-x,height=Math.min(1,box.y+box.height+0.08)-y;
  const c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(width*image.naturalWidth)); c.height=Math.max(1,Math.round(height*image.naturalHeight));
  const ctx=c.getContext('2d')!;
  ctx.drawImage(image,x*image.naturalWidth,y*image.naturalHeight,width*image.naturalWidth,height*image.naturalHeight,0,0,c.width,c.height);
  const pixels=ctx.getImageData(0,0,c.width,c.height), d=pixels.data;
  const bg=[d[0],d[1],d[2]];
  const seen=new Uint8Array(c.width*c.height), stack:number[]=[];
  for(let x=0;x<c.width;x++) stack.push(x,(c.height-1)*c.width+x);
  for(let y=0;y<c.height;y++) stack.push(y*c.width,y*c.width+c.width-1);
  while(stack.length) {
    const at=stack.pop()!; if(seen[at]) continue; seen[at]=1;
    const p=at*4;
    if(Math.max(...bg.map((v,k)=>Math.abs(d[p+k]-v)))>48) continue;
    d[p+3]=0;
    const x=at%c.width,y=Math.floor(at/c.width);
    if(x) stack.push(at-1);if(x<c.width-1) stack.push(at+1);if(y) stack.push(at-c.width);if(y<c.height-1) stack.push(at+c.width);
  }
  retainLogoComponents(d,c.width,c.height,{
    left:(box.x-x-0.04)*image.naturalWidth, right:(box.x+box.width-x+0.04)*image.naturalWidth,
    top:(box.y-y-0.01)*image.naturalHeight, bottom:(box.y+box.height-y+0.01)*image.naturalHeight,
  });
  ctx.putImageData(pixels,0,0);
  let left=c.width,top=c.height,right=-1,bottom=-1;
  for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) if(d[(y*c.width+x)*4+3]>16) {
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left || bottom<top) throw new Error('The authentic logo crop was empty.');
  const tight=document.createElement('canvas');tight.width=right-left+1;tight.height=bottom-top+1;
  tight.getContext('2d')!.drawImage(c,left,top,tight.width,tight.height,0,0,tight.width,tight.height);
  return tight;
}
export async function finishBrandImage(url:string,plan:ProductionPlan,index:number):Promise<string> {
  if(!plan.logo) return url;
  const [pixels,reference]=await Promise.all([loadImage(url),loadImage(plan.reference_previews[plan.logo.reference_index])]);
  const logo=sourceLogo(reference,plan.logo);
  const canvas=document.createElement('canvas');canvas.width=pixels.naturalWidth;canvas.height=pixels.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(pixels,0,0);
  // Preserve the composition, including headlines near the top. A generated
  // duplicate logo is a review failure; never erase an entire artwork band.
  const width=Math.min(canvas.width*0.22,canvas.height*0.29),height=width*logo.height/logo.width;
  if(height>canvas.height*0.11) throw new Error('The authentic logo crop does not fit its reserved area.');
  const position=plan.frames[index].layout?.logo_position||'top-center';
  const x=position==='top-left'?canvas.width*0.065:position==='top-right'?canvas.width*0.935-width:(canvas.width-width)/2;
  ctx.drawImage(logo,x,canvas.height*0.045,width,height);
  return canvas.toDataURL('image/png');
}
