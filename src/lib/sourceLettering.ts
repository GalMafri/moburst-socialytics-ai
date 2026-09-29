import type { EditRegion, TemplateHeadline } from '../../supabase/functions/_shared/design-prompts/referenceTemplate';
interface Glyph {pixels:number[];x:number;y:number;right:number;bottom:number;}
/** Find actual source glyphs, not guessed coordinates, and remove only their pixels. */
export function clearSourceLettering(image:ImageData,regions:EditRegion[],headline:TemplateHeadline):TemplateHeadline {
 const {width:W,height:H,data}=image;const mask=new Uint8Array(W*H);let headingRows:Glyph[][]=[];
 const containing=regions.findIndex(r=>headline.x>=r.x-0.001&&headline.y>=r.y-0.001&&headline.x+headline.width<=r.x+r.width+0.001&&headline.y+headline.height<=r.y+r.height+0.001);
 const mainIndex=containing>=0?containing:0;
 for(let ri=0;ri<regions.length;ri++){
  const r=regions[ri],main=ri===mainIndex,pad=main?0.13:0.02;
  const x0=Math.max(0,Math.floor((r.x-pad)*W)),y0=Math.max(0,Math.floor((r.y-pad)*H)),x1=Math.min(W,Math.ceil((r.x+r.width+pad)*W)),y1=Math.min(H,Math.ceil((r.y+r.height+pad)*H));
  const seen=new Uint8Array((x1-x0)*(y1-y0));const glyphs:Glyph[]=[];
  const rgb=[1,3,5].map(offset=>parseInt(headline.color.slice(offset,offset+2),16));
  const ink=(x:number,y:number)=>{const i=(y*W+x)*4;return Math.hypot(data[i]-rgb[0],data[i+1]-rgb[1],data[i+2]-rgb[2])<(main?125:190);};
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const start=(y-y0)*(x1-x0)+x-x0;if(seen[start]||!ink(x,y))continue;
   seen[start]=1;const queue=[y*W+x];const g:Glyph={pixels:[],x,y,right:x,bottom:y};
   for(let q=0;q<queue.length;q++){
    const p=queue[q],py=Math.floor(p/W),px=p%W;g.pixels.push(p);g.x=Math.min(g.x,px);g.right=Math.max(g.right,px);g.y=Math.min(g.y,py);g.bottom=Math.max(g.bottom,py);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const nx=px+dx,ny=py+dy;if(nx<x0||nx>=x1||ny<y0||ny>=y1)continue;
     const s=(ny-y0)*(x1-x0)+nx-x0;if(!seen[s]&&ink(nx,ny)){seen[s]=1;queue.push(ny*W+nx);}
    }
   }
   const gh=g.bottom-g.y+1,gw=g.right-g.x+1;
   if(g.pixels.length>=(main?12:3)&&gh>=H*(main?0.009:0.003)&&gh<=H*(main?0.075:0.035)&&gw<W*0.16&&gw<gh*2.5)glyphs.push(g);
  }
  glyphs.sort((a,b)=>a.y-b.y);const rows:Glyph[][]=[];
  for(const g of glyphs){const row=rows.find(row=>Math.abs((row[0].y+row[0].bottom-g.y-g.bottom)/2)<Math.max(row[0].bottom-row[0].y,g.bottom-g.y)*0.6);if(row)row.push(g);else rows.push([g]);}
  const valid=rows.filter(row=>row.length>=(main?3:2)&&Math.max(...row.map(g=>g.right))-Math.min(...row.map(g=>g.x))>W*(main?0.09:0.018));
  if(main){
   if(!valid.length||valid.length>8)throw new Error('Could not identify a safe source text block.');
   // Reject distant image highlights; the headline is the largest cluster of adjacent text rows.
   valid.sort((a,b)=>Math.min(...a.map(g=>g.y))-Math.min(...b.map(g=>g.y)));
   const clusters:Glyph[][][]=[];
   for(const row of valid){const prior=clusters[clusters.length-1];const previous=prior?.[prior.length-1];const gap=previous?Math.min(...row.map(g=>g.y))-Math.max(...previous.map(g=>g.bottom)):Infinity;if(previous&&gap<H*0.06)prior.push(row);else clusters.push([row]);}
   headingRows=clusters.sort((a,b)=>b.flat().length-a.flat().length)[0];
  }
  const textPixels:number[]=[];
  for(const row of (main?headingRows:valid)){
   const rh=Math.max(...row.map(g=>g.bottom))-Math.min(...row.map(g=>g.y))+1;
   const lx=Math.max(x0,Math.floor(Math.min(...row.map(g=>g.x))-rh*.35)),rx=Math.min(x1,Math.ceil(Math.max(...row.map(g=>g.right))+rh*.35));
   const ty=Math.max(y0,Math.floor(Math.min(...row.map(g=>g.y))-rh*.2)),by=Math.min(y1,Math.ceil(Math.max(...row.map(g=>g.bottom))+rh*.2));
   for(let y=ty;y<by;y++)for(let x=lx;x<rx;x++)if(ink(x,y))textPixels.push(y*W+x);
  }
  for(const p of textPixels){const py=Math.floor(p/W),px=p%W;const dilation=Math.max(2,Math.round(W/400));for(let dy=-dilation;dy<=dilation;dy++)for(let dx=-dilation;dx<=dilation;dx++){const nx=px+dx,ny=py+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H)mask[ny*W+nx]=1;}}
 }
 const glyphs=headingRows.flat();if(!glyphs.length)throw new Error('The source headline could not be measured.');
 const left=Math.min(...glyphs.map(g=>g.x)),right=Math.max(...glyphs.map(g=>g.right)),top=Math.min(...glyphs.map(g=>g.y)),bottom=Math.max(...glyphs.map(g=>g.bottom));
 const heights=headingRows.map(row=>Math.max(...row.map(g=>g.bottom))-Math.min(...row.map(g=>g.y))+1).sort((a,b)=>a-b);
 const fontSize=Math.min(heights[Math.floor(heights.length/2)]/0.76,headline.font_size*W);
 const centers=headingRows.map(row=>(Math.min(...row.map(g=>g.x))+Math.max(...row.map(g=>g.right)))/2);
 const align=Math.max(...centers)-Math.min(...centers)<W*0.04?'center':headline.align;
 // Diffuse background inward from the glyph boundaries. Original pixels outside the mask never change.
 const pending:number[]=[];const queued=new Uint8Array(mask.length);
 const neighbors=(p:number)=>[p%W?p-1:-1,p%W<W-1?p+1:-1,p>=W?p-W:-1,p<mask.length-W?p+W:-1].filter(n=>n>=0);
 let count=0;for(let p=0;p<mask.length;p++)if(mask[p]){count++;if(neighbors(p).some(n=>!mask[n])){pending.push(p);queued[p]=1;}}
 if(count>W*H*0.15)throw new Error('Source lettering is not safely separable from its artwork.');
 for(let q=0;q<pending.length;q++){
  const p=pending[q],live=neighbors(p).filter(n=>!mask[n]);if(!live.length)continue;
  for(let c=0;c<3;c++)data[p*4+c]=Math.round(live.reduce((sum,n)=>sum+data[n*4+c],0)/live.length);
  mask[p]=0;for(const n of neighbors(p))if(mask[n]&&!queued[n]){queued[n]=1;pending.push(n);}
 }
 const padX=W*0.012,padY=H*0.009;
 return {...headline,x:Math.max(0,left-padX)/W,y:Math.max(0,top-padY)/H,width:Math.min(W-left+padX,right-left+2*padX)/W,height:(bottom-top+2*padY)/H,font_size:fontSize/W,line_height:1.12,align};
}
