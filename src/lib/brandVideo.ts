import {Muxer,ArrayBufferTarget} from 'mp4-muxer';
import {loadImage,ensureBrandFont,brandFontStack} from './composeText';
import {sourceLogo} from './brandLogo';
import type {ProductionPlan} from './creativeProduction';

export function captionAt(seconds:number,duration:number,count:number) {
  return Math.min(count-1,Math.max(0,Math.floor(seconds/duration*count)));
}
function linesFor(ctx:CanvasRenderingContext2D,text:string,width:number) {
  const lines:string[]=[];let line='';
  for(const word of text.split(/\s+/)) {const next=line?`${line} ${word}`:word;if(line&&ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;}
  if(line) lines.push(line);return lines;
}
/** Composite timed type over actual video frames. No still-image animation. */
export async function finishBrandVideo(url:string,plan:ProductionPlan,onProgress?:(n:number)=>void,isCancelled=()=>false) {
  if(!plan.logo||!plan.caption_style) throw new Error('The client logo and typography could not be prepared.');
  if(typeof VideoEncoder==='undefined') throw new Error('Open this video in current Chrome to encode the finished MP4.');
  await ensureBrandFont(plan.font_family);
  const logo=sourceLogo(await loadImage(plan.reference_previews[plan.logo.reference_index]),plan.logo);
  const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.preload='auto';
  const ready=new Promise<void>((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(new Error('The rendered film could not be loaded.'));});
  video.src=url;await ready;
  if(!Number.isFinite(video.duration)||video.duration<10||video.duration>15) throw new Error('The renderer did not return the complete 12-second film.');
  const width=video.videoWidth,height=video.videoHeight,seconds=video.duration,fps=24;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!;
  const target=new ArrayBufferTarget();
  const muxer=new Muxer({target,video:{codec:'avc',width,height},fastStart:'in-memory'});
  let encodingError:Error|undefined;
  const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{encodingError=e;}});
  encoder.configure({codec:'avc1.640028',width,height,bitrate:6_000_000,framerate:fps});
  const previews:string[]=[]; const font=brandFontStack(plan.font_family).stack;
  try {
    const total=Math.floor(seconds*fps);
    for(let n=0;n<total;n++) {
      if(isCancelled()) throw new Error('Video finishing cancelled.');
      if(encodingError) throw encodingError;
      const time=n/fps;
      if(Math.abs(video.currentTime-time)>0.001) await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{video.onseeked=null;reject(new Error('Video frame decoding timed out.'));},8000);
        video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=time;
      });
      ctx.drawImage(video,0,0,width,height);
      const at=captionAt(time,seconds,plan.frames.length);
      const style=plan.caption_style;
      // An opaque identity band prevents model-drawn reference logos from
      // appearing beside the authentic source logo placed below.
      ctx.fillStyle=style.surface;ctx.fillRect(0,0,width,height*0.19);
      const size=Math.round(Math.min(width*0.053,height*0.063));
      ctx.font=`${style.font_weight} ${size}px ${font}`;
      const lines=linesFor(ctx,plan.frames[at].headline,width*0.8);
      if(lines.length>3) throw new Error('The video caption does not fit the reference typography.');
      const lineHeight=size*1.23,padding=size*0.65;
      const boxHeight=lines.length*lineHeight+padding*2;
      const top=height*0.84-boxHeight;
      ctx.save();ctx.globalAlpha=0.87;ctx.fillStyle=style.surface;
      ctx.beginPath();ctx.roundRect(width*0.07,top,width*0.86,boxHeight,size*0.3);ctx.fill();ctx.restore();
      ctx.fillStyle=style.color;ctx.textAlign='center';ctx.textBaseline='middle';
      lines.forEach((line,i)=>ctx.fillText(line,width/2,top+padding+(i+0.5)*lineHeight));
      const lw=Math.min(width*0.2,height*0.29),lh=lw*logo.height/logo.width;
      ctx.drawImage(logo,(width-lw)/2,height*0.065,lw,lh);
      if(!previews[at]&&time>at*seconds/3+1.1) previews[at]=canvas.toDataURL('image/jpeg',0.86);
      const frame=new VideoFrame(canvas,{timestamp:n*1e6/fps,duration:1e6/fps});
      encoder.encode(frame,{keyFrame:n%(fps*2)===0});frame.close();
      if(n%fps===0){onProgress?.(n/total);await new Promise(r=>setTimeout(r,0));}
    }
    await encoder.flush();if(encodingError) throw encodingError;
    muxer.finalize();
    return {blob:new Blob([target.buffer],{type:'video/mp4'}),previews,aspect:`${width} / ${height}`,seconds};
  } finally {encoder.close();video.removeAttribute('src');video.load();}
}
