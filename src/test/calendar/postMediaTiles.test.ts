import {describe,it,expect} from 'vitest';
import {mediaInUse,tilesFromIterations} from '@/lib/postMediaTiles';

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

describe('the media a post goes out with',()=>{
  it('is every row in use, oldest first, a carousel in its order',()=>{
    expect(mediaInUse([
      {id:'b',created_at:'2026-11-02',media_urls:['b.png'],is_selected:true},
      {id:'a',created_at:'2026-11-01',media_urls:['a1.png','a2.png'],is_selected:true},
      {id:'c',created_at:'2026-11-03',media_urls:['c.png'],is_selected:false,variant_angle:'Design option 1'},
    ])).toEqual(['a1.png','a2.png','b.png']);
  });
  it('is the newest design when nothing is in use, as the Design tab shows it',()=>{
    expect(mediaInUse([
      {id:'old',created_at:'2026-11-01',media_urls:['old.png'],variant_angle:'Design option 1'},
      {id:'new',created_at:'2026-11-02',media_urls:['new.png'],variant_angle:'Design option 2'},
      {id:'upload',created_at:'2026-11-03',media_urls:['upload.png']},
    ])).toEqual(['new.png']);
  });
  it('is nothing when the post has no media',()=>{
    expect(mediaInUse([{id:'copy',created_at:'2026-11-01',media_urls:[]}])).toEqual([]);
  });
});
