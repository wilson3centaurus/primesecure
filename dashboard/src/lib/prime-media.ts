export const MEDIA_CATEGORIES=['Learning','Music','Robotics','Science','Languages','Other'] as const;
export const MEDIA_MIMES=['audio/mpeg','audio/mp4','audio/ogg','audio/wav','video/mp4','video/webm'];
export function youtubeId(value:string):string|null {
 if(/^[A-Za-z0-9_-]{11}$/.test(value.trim()))return value.trim();
 try{const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  const id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)?(u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1]):null;
  return id&&/^[A-Za-z0-9_-]{11}$/.test(id)?id:null;
 }catch{return null;}
}
export function mediaChannels(value:string):{id:string;name:string}[]|null {
 const rows=value.trim()?value.trim().split(/\r?\n/).filter(Boolean):[];if(rows.length>20)return null;
 const result:{id:string;name:string}[]=[];
 for(const row of rows){const [id,...name]=row.trim().split('|');if(!/^UC[A-Za-z0-9_-]{22}$/.test(id.trim())||name.join('|').length>100)return null;result.push({id:id.trim(),name:name.join('|').trim()||id.trim()});}
 return result;
}

export function mediaMime(name:string,type:string):string {
 const ext=name.toLowerCase().split('.').pop();
 const mime:Record<string,string>={mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm'};
 return MEDIA_MIMES.includes(type)?type:mime[ext||'']||type;
}
