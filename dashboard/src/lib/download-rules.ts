export type DownloadEvent = "pages" | "resources" | "downloads";
export type DownloadSiteRule = {start_url:string;pages:string[];resources:string[];downloads:string[]};
export type DownloadRules = Partial<Record<"music"|"images",DownloadSiteRule>>;
export const DOWNLOAD_TOOLS = [
 {id:"music",title:"Music & videos",start_url:"https://v4.mp3juices.africa.com/",pages:["https://api.ytmp3.tube/mp3","https://api.ytmp3.tube/mp4"],resources:["api.ytmp3.tube","us-central1-ytmp3-tube.cloudfunctions.net","ytimg.com","suggestqueries.google.com"],downloads:["ytmp3.tube","googlevideo.com"]},
 {id:"images",title:"Images",start_url:"https://unsplash.com/",pages:[],resources:["images.unsplash.com","plus.unsplash.com"],downloads:["images.unsplash.com","plus.unsplash.com"]}
] as const;
const AD_HOSTS=["abscloud.org","rolledipocras.com","crn77.com","omg10.com","extroverted-roll.com"];
function urlRule(raw:string,start=false):string|null {
 try {
  const value=raw.trim(),full=value.includes("://");if(!value||value.length>1000||/[\s\\*]/.test(value)||(!full&&/[/?#:@]/.test(value)))return null;
  if(start&&!full)return null;
  const url=new URL(full?value:`https://${value}`),host=url.hostname;
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||!host.includes('.')||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/^\d+(\.\d+){3}$/.test(host)||host.endsWith('.local')||host.endsWith('.internal')||AD_HOSTS.some(h=>host===h||host.endsWith(`.${h}`)))return null;
  const address=value.split(/[?#]/,1)[0];
  if(/%2e|%2f|%5c/i.test(address)||/(^|\/)\.\.?($|\/)/.test(address.replace(/^https:\/\//,'')))return null;
  if(!start)url.search="";
  return full?url.href:host;
 } catch { return null; }
}
export function parseDownloadRules(form:FormData):{rules:DownloadRules;error?:never}|{error:string;rules?:never} {
 const rules:DownloadRules={};
 for(const tool of DOWNLOAD_TOOLS) {
  const start=urlRule(String(form.get(`download_${tool.id}_start_url`)??tool.start_url),true);
  if(!start)return {error:`${tool.title}: use a public HTTPS start URL without credentials or an advertising host.`};
  const row:DownloadSiteRule={start_url:start,pages:[],resources:[],downloads:[]};
  for(const event of ["pages","resources","downloads"] as const) {
   const raw=String(form.get(`download_${tool.id}_${event}`)??tool[event].join('\n'));
   const lines=[...new Set(raw.split(/[\s,]+/).filter(Boolean))];
   if(lines.length>40)return {error:`${tool.title}: use at most 40 ${event} entries.`};
   for(const line of lines) {
    const rule=urlRule(line);if(!rule)return {error:`${tool.title}: invalid ${event} entry. Use an HTTPS URL prefix or domain; no wildcards, credentials, private addresses or advertising hosts.`};
    row[event].push(rule);
   }
  }
  rules[tool.id]=row;
 }
 if(JSON.stringify(rules).length>20000)return {error:"Download URL settings are too large. Use fewer, stable URL prefixes."};
 return {rules};
}
