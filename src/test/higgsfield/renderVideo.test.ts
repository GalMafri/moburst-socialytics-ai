import { describe, expect, it } from "vitest";
import { HOLD_THE_FRAME, videoJobSnapshot } from "../../../supabase/functions/_shared/higgsfield/renderVideo";

describe('provider collection status',()=>{
  const snapshot=(status:string,extra={})=>({outcomes:[{index:0,job_id:'paid-job',status,...extra}],allTerminal:['lookup_failed','ip_detected','completed'].includes(status),waitedMs:0});
  it('does not disguise a permanent lookup failure as a running film',()=>{
    expect(()=>videoJobSnapshot(snapshot('lookup_failed',{error:'Session expired'}))).toThrow('Session expired');
  });
  it('treats provider IP rejection as terminal and preserves its reason',()=>{
    expect(videoJobSnapshot(snapshot('ip_detected',{error:'Provider rejected input'}))).toEqual({status:'failed',url:null,error:'Provider rejected input'});
  });
  it('collects completed jobs and preserves real active states',()=>{
    expect(videoJobSnapshot(snapshot('completed',{result_url:'finished.mp4'})).url).toBe('finished.mp4');
    expect(videoJobSnapshot(snapshot('queued')).status).toBe('running');
  });
});

describe("HOLD_THE_FRAME", () => {
  it("forbids the camera moves that walked the headline out of shot", () => {
    // Measured on a real clip: the opening frame was correct and by the last
    // frame the headline had drifted off the left edge behind a prop.
    for (const forbidden of ["push in", "pan", "crop", "reframing"]) {
      expect(HOLD_THE_FRAME.toLowerCase()).toContain(forbidden);
    }
  });

  it("says the text must stay legible for the whole clip", () => {
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("legible");
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("first frame to the last");
  });

  it("still allows the motion that makes a clip worth having", () => {
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("glow");
  });
});
