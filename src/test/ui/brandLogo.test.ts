import {describe,it,expect} from 'vitest';
import {retainLogoComponents} from '@/lib/brandLogo';

describe('authentic logo extraction',()=>{
  it('keeps full letters extending beyond approximate bounds and removes unrelated edge decoration',()=>{
    const w=14,h=8,pixels=new Uint8ClampedArray(w*h*4);
    const ink=(x:number,y:number)=>{pixels[(y*w+x)*4+3]=255;};
    // Two separate glyphs, both extending below the measured logo region.
    for(let y=1;y<=6;y++) {ink(3,y);ink(6,y);}
    ink(2,6);ink(7,6);
    // Unrelated glow at the expanded crop boundary.
    for(let y=4;y<8;y++) {ink(12,y);ink(13,y);}
    retainLogoComponents(pixels,w,h,{left:3,top:1,right:6,bottom:3});
    expect(pixels[(6*w+2)*4+3]).toBe(255);
    expect(pixels[(6*w+7)*4+3]).toBe(255);
    expect(pixels[(4*w+12)*4+3]).toBe(0);
  });
});
