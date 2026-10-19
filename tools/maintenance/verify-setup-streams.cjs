const {chromium}=require('C:/Users/XO/AppData/Local/Temp/primesecure-split-qa/node_modules/playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('agent/app/src/main/assets/student');
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!['index.html','workspace.js','workspace.css','primebook.png','robokorda.jpg'].includes(name)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png');res.end(fs.readFileSync(path.join(root,name)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
 try{
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.requests=[];window.PrimeNative={request:raw=>requests.push(JSON.parse(raw))};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{window.fixture={device_id:'qa',student_name:'QA learner',school_name:'QA school',online:true,welcome_complete:true,student_profile:{},hidden_keys:[],favorite_keys:[],pinned_keys:[],capabilities:{},items:[],messages:[],tasks:[],catalog_fetched_at_ms:Date.now(),sync_error:'A temporary catalog request failed',setup_progress:{elapsed_ms:2000,complete:false,streams:[{kind:'wallpaper',label:'Wallpapers',total_items:85,completed_items:50,total_bytes:10000,completed_bytes:6000,elapsed_ms:2000,complete:false},{kind:'app',label:'Apps',total_items:34,completed_items:2,total_bytes:10000,completed_bytes:1000,elapsed_ms:2000,complete:false},{kind:'resource',label:'School notes',total_items:2116,completed_items:15,total_bytes:10000,completed_bytes:200,elapsed_ms:2000,complete:false}]}};receiveState(JSON.stringify(fixture));});
  await page.locator('.nav[data-view="Background tasks"]').click();assert.equal(await page.getByRole('tab').count(),3);
  assert.match(await page.locator('#page').innerText().catch(()=>page.locator('body').innerText()),/notes images, apps, and notes documents/);
  assert.match(await page.getByRole('alert').innerText(),/temporary catalog request failed/);
  await page.getByRole('tab',{name:/Wallpapers/}).click();assert.match(await page.locator('#setup-stream-panel').innerText(),/50 \/ 85/);
  await page.getByRole('button',{name:'Sync now',exact:true}).click();assert(await page.evaluate(()=>requests.some(r=>r.action==='sync')));
  await page.getByRole('tab',{name:/School Notes/}).click();assert.match(await page.locator('#setup-stream-panel').innerText(),/15 \/ 2116/);
  await page.screenshot({path:'artifacts/setup-streams-0.9.2.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tabs:3,wallpaper_total:85,notes_total:2116,error_visible:true,manual_sync_bridge:true,page_errors:errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
