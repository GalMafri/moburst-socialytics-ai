import { clearSourceLettering } from './sourceLettering';
import { loadImage } from './composeText';
import type { EditRegion, TemplateHeadline } from '../../supabase/functions/_shared/design-prompts/referenceTemplate';

const loadedFonts=new Map<string,Promise<void>>();
function loadTemplateFont(family:string):Promise<void> {
  if (family==='Arial'||family==='Georgia') return Promise.resolve();
  if (family==='Open Sans') {
    if (!loadedFonts.has(family)) loadedFonts.set(family,Promise.race([
      Promise.all([400,700].map(async weight=>{const face=new FontFace('Open Sans',`url(/fonts/open-sans-${weight}.ttf)`,{weight:String(weight)});await face.load();document.fonts.add(face);})).then(()=>undefined),
      new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('The source font could not be loaded.')),8000)),
    ]));
    return loadedFonts.get(family)!;
  }
  if (!['Roboto','Open Sans','Montserrat','Poppins','Inter','Lato','Oswald'].includes(family)) return Promise.reject(new Error('Unsupported source font.'));
  if (!loadedFonts.has(family)) loadedFonts.set(family,(async()=>{
    await new Promise<void>((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';
      link.href=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g,'+')}:wght@400;700&display=block`;
      const timeout=setTimeout(()=>reject(new Error('The source font could not be loaded.')),8000);
      link.onload=()=>{clearTimeout(timeout);resolve();};link.onerror=()=>{clearTimeout(timeout);reject(new Error('The source font could not be loaded.'));};
      document.head.appendChild(link);
    });
    const faces=await Promise.all([document.fonts.load(`400 40px "${family}"`),document.fonts.load(`700 40px "${family}"`)]);
    if(faces.some(f=>!f.length)) throw new Error('The source font is unavailable; design withheld.');
  })());
  return loadedFonts.get(family)!;
}

export interface TemplateWord {text:string;bold:boolean;}
export function wrapTemplateWords(words:TemplateWord[],maxWidth:number,measure:(text:string,bold:boolean)=>number):TemplateWord[][] {
  const lines:TemplateWord[][]=[];let line:TemplateWord[]=[];let width=0;
  for(const word of words){
    const gap=line.length?measure(' ',line[line.length-1].bold):0;
    const next=measure(word.text,word.bold);
    if(line.length && width+gap+next>maxWidth){lines.push(line);line=[];width=0;}
    width+=(line.length?measure(' ',line[line.length-1].bold):0)+next;line.push(word);
  }
  if(line.length) lines.push(line);
  return lines;
}

/** Adapt the real source directly: clear detected lettering and typeset approved copy. */
export async function applyReferenceTemplate(sourceUrl:string, _editedUrl:string, regions:EditRegion[],headline?:TemplateHeadline,copy?:string):Promise<string> {
  if (!regions.length || regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1||r.y+r.height>1)||regions.reduce((a,r)=>a+r.width*r.height,0)>0.35) throw new Error('Invalid client template edit regions.');
  if(!headline || !copy?.trim()) throw new Error('Measured source typography and approved headline are required.');
  await loadTemplateFont(headline.font_family);
  const source=await loadImage(sourceUrl);
  const canvas=document.createElement('canvas');
  canvas.width=source.naturalWidth; canvas.height=source.naturalHeight;
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('Cannot compose the client template.');
  ctx.drawImage(source,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  headline=clearSourceLettering(pixels,regions,headline);
  ctx.putImageData(pixels,0,0);
  const words=copy.trim().split(/\s+/).map((text,i,all)=>({text,bold:headline.font_weight===700||i>=all.length-headline.emphasis_words}));
  const width=headline.width*canvas.width,height=headline.height*canvas.height;
  const baseSize=headline.font_size*canvas.width;
  let size=baseSize,lines:TemplateWord[][]=[];
  const measure=(text:string,bold:boolean)=>{ctx.font=`${bold?700:400} ${size}px "${headline.font_family}"`;return ctx.measureText(text).width;};
  for(;size>=baseSize*0.65;size-=1){
    lines=wrapTemplateWords(words,width,measure);
    if(lines.length*size*headline.line_height<=height && words.every(w=>measure(w.text,w.bold)<=width)) break;
  }
  if(size<baseSize*0.65) throw new Error('The headline does not fit this source layout without changing its typography.');
  const lineHeight=size*headline.line_height;
  const top=headline.y*canvas.height+(height-lines.length*lineHeight)/2;
  ctx.save();ctx.beginPath();ctx.rect(headline.x*canvas.width,headline.y*canvas.height,width,height);ctx.clip();
  ctx.fillStyle=headline.color;ctx.textBaseline='middle';ctx.textAlign='left';
  lines.forEach((line,i)=>{
    const lineWidth=line.reduce((sum,w,j)=>sum+measure(w.text,w.bold)+(j?measure(' ',line[j-1].bold):0),0);
    let x=headline.x*canvas.width+(headline.align==='center'?(width-lineWidth)/2:headline.align==='right'?width-lineWidth:0);
    line.forEach((w,j)=>{if(j)x+=measure(' ',line[j-1].bold);ctx.font=`${w.bold?700:400} ${size}px "${headline.font_family}"`;ctx.fillText(w.text,x,top+(i+0.5)*lineHeight);x+=measure(w.text,w.bold);});
  });
  ctx.restore();
  return canvas.toDataURL('image/png');
}
