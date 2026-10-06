import {McpClient} from './mcp.ts';
import {MCP_URL,accessTokenFor} from './oauth.ts';
import {HiggsfieldError,IMAGE_MODEL,creditBalance,importReferences,submitImage} from './generate.ts';

/** Submission only: the image queue must not consume the edge request window. */
export async function startImageWithHiggsfield(db:any,prompt:string,aspect:string,referenceUrls:string[],opts:{minReferences?:number;model?:string;extra?:Record<string,unknown>}={}) {
  const mcp=new McpClient({url:MCP_URL,accessToken:await accessTokenFor(db),timeoutMs:30000});
  const balance=await creditBalance(mcp);
  if(balance&&balance.credits<20) throw new HiggsfieldError('The Higgsfield account needs more credits before starting another design.');
  const referenceIds=await importReferences(mcp,referenceUrls,'image');
  const min=opts.minReferences??2;
  if(referenceIds.length!==referenceUrls.length||referenceIds.length<min) throw new HiggsfieldError('The selected client references could not be loaded. No design was started.');
  const model=opts.model||IMAGE_MODEL;
  const jobs=await submitImage(mcp,{prompt,aspect,referenceIds,resolution:'2k',model,extra:opts.extra});
  return {jobId:jobs[0].job_id,model};
}

/** The design edit: one of the client's own posts is the source of structure and components; GPT Image 2.5 edits it. */
export const DESIGN_EDIT_MODEL='gpt_image_2_5';
export function startDesignEdit(db:any,prompt:string,aspect:string,sourceUrl:string) {
  return startImageWithHiggsfield(db,prompt,aspect,[sourceUrl],{minReferences:1,model:DESIGN_EDIT_MODEL,extra:{quality:'high'}});
}
