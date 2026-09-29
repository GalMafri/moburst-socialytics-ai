import {McpClient} from './mcp.ts';
import {MCP_URL,accessTokenFor} from './oauth.ts';
import {HiggsfieldError,IMAGE_MODEL,creditBalance,importReferences,submitImage} from './generate.ts';

/** Submission only: the image queue must not consume the edge request window. */
export async function startImageWithHiggsfield(db:any,prompt:string,aspect:string,referenceUrls:string[]) {
  const mcp=new McpClient({url:MCP_URL,accessToken:await accessTokenFor(db),timeoutMs:30000});
  const balance=await creditBalance(mcp);
  if(balance&&balance.credits<20) throw new HiggsfieldError('The Higgsfield account needs more credits before starting another design.');
  const referenceIds=await importReferences(mcp,referenceUrls,'image');
  if(referenceIds.length!==referenceUrls.length||referenceIds.length<2) throw new HiggsfieldError('The selected client references could not be loaded. No design was started.');
  const jobs=await submitImage(mcp,{prompt,aspect,referenceIds,resolution:'2k',model:IMAGE_MODEL});
  return {jobId:jobs[0].job_id,model:IMAGE_MODEL};
}
