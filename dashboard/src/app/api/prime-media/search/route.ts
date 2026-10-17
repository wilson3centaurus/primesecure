import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from '@/lib/env';
import {schoolSearchAllowed} from '@/lib/school-search-safety';

export const maxDuration=30;
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9._-]{30,8000}$/.test(authorization))return Response.json({error:'School device sign-in required.'},{status:401,headers});
 if(Number(request.headers.get('content-length')||0)>2048)return Response.json({error:'Search is too long.'},{status:400,headers});
 let query:string,channel:string;
 try{const raw=await request.text();if(raw.length>2048)throw Error();const data=JSON.parse(raw);query=String(data.query||'').trim();channel=String(data.channel||'');if(query.length<2||query.length>120||channel&&!/^UC[A-Za-z0-9_-]{22}$/.test(channel))throw Error();}
 catch{return Response.json({error:'Enter 2–120 characters and choose a valid channel.'},{status:400,headers});}
 const db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:{user},error:authError}=await db.auth.getUser(authorization.slice(7));
 if(authError||!user)return Response.json({error:'Your school session expired. Sync and try again.'},{status:401,headers});
 const {data:cfg,error:policyError}=await db.rpc('device_prime_media');
 if(policyError||!cfg?.enabled||!cfg.youtube_search)return Response.json({error:'YouTube search is not enabled for this device. Browse your school collection.'},{status:403,headers});
 if(cfg.channels.length&&!cfg.channels.some((c:{id:string})=>c.id===channel))return Response.json({error:'Choose a school-approved channel.'},{status:403,headers});
 // Apply before spending quota or requesting results. Raw search terms are not logged.
 if(!schoolSearchAllowed(query))return Response.json({error:'This search is not available on school devices. Try a learning topic or contact Support.'},{status:422,headers});
 if(!process.env.YOUTUBE_API_KEY)return Response.json({error:'YouTube search is awaiting school setup. Your approved collection is still available.'},{status:503,headers});
 const {error:budgetError}=await db.rpc('device_prime_media_search_gate',{p_channel:channel});
 if(budgetError)return Response.json({error:budgetError.message},{status:429,headers});
 const url=new URL('https://www.googleapis.com/youtube/v3/search');
 Object.entries({key:process.env.YOUTUBE_API_KEY,part:'snippet',q:query,type:'video',maxResults:'12',safeSearch:'strict',videoEmbeddable:'true',videoSyndicated:'true',...(channel?{channelId:channel}:{})}).forEach(([k,v])=>url.searchParams.set(k,v));
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store',redirect:'error'});
  if(!response.ok)return Response.json({error:response.status===403?'YouTube search is unavailable or its quota is used. Browse the school collection.':'YouTube could not answer. Please try again later.'},{status:503,headers});
  const result=await response.json();
  const items=(Array.isArray(result.items)?result.items:[]).filter((i:{id?:{videoId?:string};snippet?:{channelId?:string}})=>/^[A-Za-z0-9_-]{11}$/.test(i.id?.videoId||'')&&(!channel||i.snippet?.channelId===channel)).slice(0,12).map((i:{id:{videoId:string};snippet:{title:string;channelTitle:string;channelId:string}})=>({video_id:i.id.videoId,title:String(i.snippet.title||'Video').slice(0,160),channel:String(i.snippet.channelTitle||'YouTube').slice(0,160),channel_id:i.snippet.channelId,category:'YouTube'}));
  return Response.json({items},{headers});
 }catch{return Response.json({error:'YouTube search timed out. Please try again when connected.'},{status:503,headers});}
}
