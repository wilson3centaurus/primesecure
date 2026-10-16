// Ordinary browser downloads of the reviewed public resources; no challenge bypass.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const base=process.env.PRIMESECURE_WEB_STAGE;
const {chromium}=require(path.join(base,'node_modules/playwright'));
(async()=>{
 const root=path.join(base,'out'),out=path.join(root,'sytbay-pdfs');fs.mkdirSync(out,{recursive:true});
 const rows=JSON.parse(fs.readFileSync(path.join(base,'inputs.json'),'utf8')).sytbay;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true});
 let index=0,results=[];
 async function worker(){
  const page=await context.newPage();
  await page.route('**/*',r=>['image','font','media'].includes(r.request().resourceType())?r.abort():r.continue());
  while(index<rows.length){
   const row=rows[index++],file=path.join(out,row.filename);let result={...row};
   try{
    if(fs.existsSync(file)&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===row.sha256){results.push(result);continue;}
    const response=await page.goto(row.page_url,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response.ok())throw Error('Public page HTTP '+response.status());
    const link=page.locator('a[href*="slc_download_id"]').first();
    if(!await link.count())throw Error('No public download link');
    const waiting=page.waitForEvent('download',{timeout:45000});
    await link.click({timeout:10000,noWaitAfter:true});const download=await waiting;await download.saveAs(file);
    const data=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(data).digest('hex')!==row.sha256)throw Error('Publisher content changed from reviewed checksum');
   }catch(e){result.success=false;result.error=e.message.slice(0,160);}
   results.push(result);fs.writeFileSync(path.join(root,'sytbay-downloads.json'),JSON.stringify(results,null,2));
   if(results.length%10===0)console.log(JSON.stringify({browser_downloads:results.length,of:rows.length,failed:results.filter(r=>!r.success).length}));
  }
  await page.close();
 }
 // Probe first: don't repeat 188 requests if the public site refuses the browser.
 const probe=await context.newPage();const response=await probe.goto(rows[0].page_url,{waitUntil:'domcontentloaded',timeout:30000});
 if(response.status()!==200||!await probe.locator('a[href*="slc_download_id"]').count())throw Error('Public site unavailable to server browser: HTTP '+response.status());
 await probe.close();await Promise.all([worker(),worker(),worker()]);await browser.close();
 fs.writeFileSync(path.join(root,'sytbay-downloads.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({complete:true,success:results.filter(r=>r.success).length,failed:results.filter(r=>!r.success).length}));
})().catch(e=>{console.error(e.message);process.exit(1)});
