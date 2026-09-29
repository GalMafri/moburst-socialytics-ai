import {describe,it,expect} from 'vitest';
import {tilesFromIterations} from '@/lib/postMediaTiles';

describe('saved post media',()=>{
  const rows=[
    {id:'old',created_at:'2026-09-28',variant_group_id:'old',media_urls:['old.png']},
    {id:'carousel',created_at:'2026-09-29',variant_group_id:'images',media_urls:['one.png','two.png','three.png'],is_selected:true},
    {id:'film',created_at:'2026-09-30',variant_group_id:'video',media_urls:['film.mp4'],is_selected:true},
  ];
  it('keeps the latest complete carousel visible after a video is saved',()=>{
    expect(tilesFromIterations(rows,u=>u.endsWith('.png')).map(x=>x.url)).toEqual(['one.png','two.png','three.png']);
  });
  it('keeps the film available alongside its cover artwork',()=>{
    expect(tilesFromIterations([...rows,{id:'cover',created_at:'2026-10-01',media_urls:['cover.png']}],u=>u.endsWith('.mp4'))).toEqual([{iterationId:'film',url:'film.mp4',isSelected:true}]);
  });
  it('preserves the selection of all slides stored in one carousel row',()=>{
    expect(tilesFromIterations(rows,u=>u.endsWith('.png')).every(x=>x.isSelected&&x.iterationId==='carousel')).toBe(true);
  });
});
