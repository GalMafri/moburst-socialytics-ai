import {brandFontStack,ensureBrandFont,loadImage} from './composeText';
import type {ProductionPlan} from './creativeProduction';
import {platformDesignSpec} from '../../supabase/functions/_shared/design-prompts/aspect';

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

/** Where the brand keeps its logo, measured from the reference the logo was cut from. */
export function brandLogoPosition(plan:ProductionPlan,index:number):'top-left'|'top-center'|'top-right' {
  if(plan.logo) {
    const cx=plan.logo.x+plan.logo.width/2;
    if(cx<0.4) return 'top-left';
    if(cx>0.6) return 'top-right';
    return 'top-center';
  }
  return plan.frames[index].layout?.logo_position||'top-center';
}

type Word={text:string;emphasis:boolean};
function wrapWords(ctx:CanvasRenderingContext2D,words:Word[],maxWidth:number,fonts:{regular:string;bold:string}):Word[][] {
  const lines:Word[][]=[];let line:Word[]=[];let width=0;
  const space=(font:string)=>{ctx.font=font;return ctx.measureText(' ').width;};
  for(const word of words) {
    ctx.font=word.emphasis?fonts.bold:fonts.regular;
    const w=ctx.measureText(word.text).width;
    const gap=line.length?space(fonts.regular):0;
    if(line.length&&width+gap+w>maxWidth) {lines.push(line);line=[word];width=w;}
    else {line.push(word);width+=gap+w;}
  }
  if(line.length) lines.push(line);
  return lines;
}

/**
 * The brand system, set in code: a frosted headline card in the measured
 * surface colour, the headline in the brand typeface with its emphasis phrase
 * in the measured accent, and the authentic logo where the brand keeps it.
 * The model painted only the artwork behind it.
 */
export async function finishBrandStatic(url:string,plan:ProductionPlan,index:number,post:{platform?:string;format?:string}={}):Promise<string> {
  const frame=plan.frames[index];
  const spec=platformDesignSpec(post.platform,post.format);
  // Plans made before typography was measured for stills carry no
  // caption_style; white type on a dark card is the neutral reading.
  const style=plan.caption_style||{color:'#ffffff',surface:'#101820',font_weight:400};
  if(!plan.logo) return url;
  await ensureBrandFont(plan.font_family);
  const [pixels,reference]=await Promise.all([loadImage(url),loadImage(plan.reference_previews[plan.logo.reference_index])]);
  const logo=sourceLogo(reference,plan.logo);
  const canvas=document.createElement('canvas');canvas.width=pixels.naturalWidth;canvas.height=pixels.naturalHeight;
  const W=canvas.width,H=canvas.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(pixels,0,0);
  const font=brandFontStack(plan.font_family).stack;
  const region=frame.layout?.headline_position||'left';
  const landscape=W>H*1.2;
  // The platform's own interface covers part of the frame; the card, the
  // headline and the logo stay inside what remains.
  const safeL=W*spec.safe.left,safeR=W*spec.safe.right,safeT=H*spec.safe.top,safeB=H*spec.safe.bottom;
  const innerW=W-safeL-safeR,innerH=H-safeT-safeB;
  const side=region==='left'||region==='right';
  const cardW=side?innerW*(landscape?0.48:0.56):innerW;
  const x=region==='right'?W-safeR-cardW:safeL;
  // Type size from the platform spec, reduced until at most four lines fit the region.
  let size=Math.round(W*spec.headlineScale);
  const words:Word[]=(()=>{
    const headline=frame.headline.trim();
    const emphasis=frame.emphasis?.trim();
    const at=emphasis?headline.toLowerCase().indexOf(emphasis.toLowerCase()):-1;
    const parts:Word[]=[];
    const push=(text:string,em:boolean)=>text.split(/\s+/).filter(Boolean).forEach(t=>parts.push({text:t,emphasis:em}));
    if(at<0) push(headline,false);
    else {push(headline.slice(0,at),false);push(headline.slice(at,at+emphasis!.length),true);push(headline.slice(at+emphasis!.length),false);}
    return parts;
  })();
  const padding=()=>size*0.75;
  let lines:Word[][]=[];
  for(;size>=Math.round(H*0.02);size-=2) {
    const fonts={regular:`${style.font_weight} ${size}px ${font}`,bold:`700 ${size}px ${font}`};
    lines=wrapWords(ctx,words,cardW-padding()*2,fonts);
    const cardH=lines.length*size*1.22+padding()*2;
    if(lines.length<=4&&cardH<=innerH*(side?0.62:0.44)) break;
  }
  const fonts={regular:`${style.font_weight} ${size}px ${font}`,bold:`700 ${size}px ${font}`};
  const lineH=size*1.22,pad=padding();
  const cardH=lines.length*lineH+pad*2;
  const lw=Math.min(W*spec.logoWidth,H*0.29),lh=lw*logo.height/logo.width;
  const logoTop=safeT+H*0.03;
  const logoBand=logoTop+lh+H*0.035;
  const y=region==='top'?Math.max(logoBand,safeT+innerH*0.12):region==='bottom'?H-safeB-innerH*0.06-cardH:Math.max(logoBand,safeT+(innerH-cardH)/2);
  const radius=size*0.55;
  // Frosted card: blurred backdrop, surface tint, hairline edge.
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,cardW,cardH,radius);ctx.clip();
  ctx.filter=`blur(${Math.round(Math.min(W,H)*0.012)}px)`;ctx.drawImage(pixels,0,0,W,H);ctx.filter='none';
  ctx.globalAlpha=0.62;ctx.fillStyle=style.surface;ctx.fillRect(x,y,cardW,cardH);
  ctx.globalAlpha=1;const sheen=ctx.createLinearGradient(x,y,x,y+cardH);sheen.addColorStop(0,'rgba(255,255,255,0.07)');sheen.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sheen;ctx.fillRect(x,y,cardW,cardH);ctx.restore();
  ctx.strokeStyle='rgba(255,255,255,0.16)';ctx.lineWidth=Math.max(1,W/1000);
  ctx.beginPath();ctx.roundRect(x,y,cardW,cardH,radius);ctx.stroke();
  // Headline, left aligned in the card, emphasis in the accent.
  ctx.textBaseline='middle';ctx.textAlign='left';
  lines.forEach((line,i)=>{
    let cx=x+pad;const cy=y+pad+(i+0.5)*lineH;
    line.forEach((word,j)=>{
      ctx.font=word.emphasis?fonts.bold:fonts.regular;
      ctx.fillStyle=word.emphasis?(style.accent||style.color):style.color;
      ctx.fillText(word.text,cx,cy);
      cx+=ctx.measureText(word.text).width;
      if(j<line.length-1){ctx.font=fonts.regular;cx+=ctx.measureText(' ').width;}
    });
  });
  // Authentic logo where the brand keeps it, inside the safe area.
  if(lh>H*0.12) throw new Error('The authentic logo crop does not fit its reserved area.');
  const position=brandLogoPosition(plan,index);
  const lx=position==='top-left'?safeL+W*0.005:position==='top-right'?W-safeR-lw-W*0.005:(W-lw)/2;
  ctx.drawImage(logo,lx,logoTop,lw,lh);
  return canvas.toDataURL('image/png');
}
