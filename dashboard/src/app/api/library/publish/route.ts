import { createClient } from '@/lib/supabase/server';
import { publishItem } from '@/app/(app)/library/actions';

export const maxDuration=120;
export async function POST(request:Request){
 // Next/proxies may use an internal hostname in request.url. The browser's Host
 // header retains the public dashboard host; do not trust a client-supplied forwarded host.
 let sameOrigin=false;
 try{const origin=new URL(request.headers.get('origin')||'');sameOrigin=['http:','https:'].includes(origin.protocol)&&origin.host===(request.headers.get('host')||new URL(request.url).host);}catch{}
 if(!sameOrigin)return Response.json({error:'Upload requests must come from this dashboard.'},{status:403});
 try{
  const client=await createClient();const {data:{user}}=await client.auth.getUser();
  if(!user)return Response.json({error:'Your session expired. Sign in and Retry.'},{status:401});
  if(Number(request.headers.get('content-length')||0)>16_000)return Response.json({error:'Upload details are too large.'},{status:400});
  const text=await request.text();if(text.length>16_000)return Response.json({error:'Upload details are too large.'},{status:400});
  const data=JSON.parse(text);
  if(!data||typeof data!=='object'||data.ownerId!==user.id)return Response.json({error:'Sign in with the account that queued this upload.'},{status:403});
  if(!['kind','title','description','form','subject','category','path','mime','schoolId','uploadId'].every(k=>typeof data[k]==='string')||
   !/^[0-9a-f-]{36}$/i.test(data.schoolId)||!Number.isSafeInteger(data.size)||data.size<=0||typeof data.shared!=='boolean'||typeof data.preinstall!=='boolean')return Response.json({error:'Invalid upload details.'},{status:400});
  const {data:profile}=await client.from('profiles').select('id').eq('id',user.id).maybeSingle();
  if(!profile)return Response.json({error:'School staff access is required.'},{status:403});
  const result=await publishItem(data);
  return Response.json(result||{error:'Publishing did not finish.'},{status:result?.error?422:200,headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof SyntaxError)return Response.json({error:'Invalid upload details.'},{status:400});
  return Response.json({error:'Publishing was interrupted. Retry this upload; its file is saved.'},{status:503});
 }
}
