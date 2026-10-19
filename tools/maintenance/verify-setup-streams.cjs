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
  await page.evaluate(()=>{window.fixture={device_id:'qa',student_name:'QA learner',school_name:'QA school',online:true,welcome_complete:true,student_profile:{},hidden_keys:[],favorite_keys:[],pinned_keys:[],capabilities:{},items:[],messages:[],tasks:[],catalog_fetched_at_ms:Date.now(),sync_error:'A temporary catalog request failed',setup_progress:{catalog_known:true,elapsed_ms:2000,complete:false,streams:[{kind:'wallpaper',label:'Wallpapers',total_items:85,completed_items:50,total_bytes:10000,completed_bytes:6000,elapsed_ms:2000,complete:false},{kind:'app',label:'Apps',total_items:34,completed_items:2,total_bytes:10000,completed_bytes:1000,elapsed_ms:2000,complete:false},{kind:'resource',label:'School notes',total_items:2116,completed_items:15,total_bytes:10000,completed_bytes:200,elapsed_ms:2000,complete:false}]}};receiveState(JSON.stringify(fixture));});
  await page.locator('.nav[data-view="Background tasks"]').click();assert.equal(await page.getByRole('tab').count(),3);
  assert.match(await page.locator('#page').innerText().catch(()=>page.locator('body').innerText()),/notes images, apps, and notes documents/);
  assert.match(await page.getByRole('alert').innerText(),/temporary catalog request failed/);
  await page.getByRole('tab',{name:/Wallpapers/}).click();assert.match(await page.locator('#setup-stream-panel').innerText(),/50 \/ 85/);
  await page.locator('#workspace-page').getByRole('button',{name:'Sync now',exact:true}).click();assert(await page.evaluate(()=>requests.some(r=>r.action==='sync')));
  await page.getByRole('tab',{name:/School Notes/}).click();assert.match(await page.locator('#setup-stream-panel').innerText(),/15 \/ 2116/);
  const countChecks=await verifyTaskCounts(page);
  await page.screenshot({path:'artifacts/setup-streams-0.9.2.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({countChecks,tabs:3,wallpaper_total:85,notes_total:2116,error_visible:true,manual_sync_bridge:true,page_errors:errors}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

async function verifyTaskCounts(page){
 const badge=()=>page.locator('[data-nav-count="Background tasks"]'),home=()=>page.locator('.nav[data-view="Home"]').click(),tasks=()=>page.locator('.nav[data-view="Background tasks"]').click();
 const downloads=()=>page.evaluate(()=>{view='Downloads';renderPage(true)}),checks=[];
 await page.evaluate(()=>{
  fixture.items=[...Array.from({length:2116},(_,i)=>({id:'r'+i,kind:'resource',title:'Note '+i,available:i<15,size:100})),...Array.from({length:85},(_,i)=>({id:'w'+i,kind:'wallpaper',title:'Wallpaper '+i,available:i<50,size:100})),...Array.from({length:34},(_,i)=>({id:'a'+i,kind:'app',title:'Required app '+i,required:true,installed:i<2,size:100})),{id:'optional',kind:'app',title:'Optional app',required:false},{id:'media',kind:'media',title:'School audio'}];
  fixture.tasks=[...Array.from({length:142},(_,i)=>({id:'t'+i,item_id:'r'+(1000+i),key:'download:r'+(1000+i),action:'download',title:'Note task '+i,status:i<92?'done':'queued',bytes:0,total:100})),
   {id:'profile',action:'profile',title:'Save profile',status:'queued'},
   {id:'personal',action:'web_download',title:'Personal download',status:'waiting'},
   {id:'optional',item_id:'optional',action:'install',title:'Optional app',status:'queued'},
   {id:'media',item_id:'media',action:'download',title:'School audio',status:'queued'},
   {id:'choice',item_id:'w1',action:'wallpaper',title:'Apply wallpaper',status:'queued'},
   {id:'required',item_id:'a10',action:'install',title:'Required app',status:'queued'},
   {id:'failed',action:'profile',title:'Failed change',status:'failed',error:'Retry needed'},
   {id:'obsolete',action:'web_download',title:'Old task',status:'superseded',error:'Old error'}];
  fixture.sync_error='A temporary catalog request failed: SSL <retry> & preserved';receiveState(JSON.stringify(fixture));
 });
 await home();
 // 35 wallpapers + 32 required apps + 2101 notes + five non-setup jobs.
 // The 50 recent setup jobs and required-app task must not count twice.
 assert.equal(await page.locator('[data-home-pending]').innerText(),'2173');
 assert.equal(await badge().innerText(),'2173');
 assert.match(await page.locator('[data-home-task-label]').innerText(),/Needs attention/);
 checks.push('full totals plus non-setup jobs without capped-history double count');
 await downloads();assert.match(await page.locator('[data-download-pending]').innerText(),/^2173 tasks pending/);
 checks.push('download shortcut uses full pending count');
 await tasks();
 assert.match(await page.getByRole('alert').innerText(),/Last sync\/transfer issue.*SSL <retry> & preserved/);
 assert.match(await page.locator('#sync-error').innerText(),/Last sync\/transfer issue.*SSL <retry> & preserved/s);
 assert.match(await page.locator('.task-summary').innerText(),/Connected; some transfers will retry/);
 checks.push('exact historical error and online retry status');
 await home();
 await page.evaluate(()=>{fixture.setup_progress.streams[0].completed_items=64;receiveState(JSON.stringify(fixture));});
 assert.equal(await page.locator('[data-home-pending]').innerText(),'2159');assert.equal(await badge().innerText(),'2159');
 await tasks();assert.match(await page.getByRole('tab',{name:/Wallpapers/}).innerText(),/64 \/ 85/);
 checks.push('numeric-only full snapshot refreshes home nav and tabs');
 await page.getByRole('tab',{name:/Wallpapers/}).click();
 await page.evaluate(()=>{fixture.setup_progress.streams[0].completed_bytes=7000;receiveState(JSON.stringify(fixture));});
 assert.equal(await page.locator('#setup-stream-panel progress').getAttribute('value'),'70');
 checks.push('byte-only full snapshot refreshes the stream progress bar');
 await page.getByRole('tab',{name:/School Notes/}).click();
 await page.evaluate(()=>{const task=fixture.tasks.find(t=>t.id==='t100');task.bytes=20;task.speed=10;task.error='New transfer issue';receiveTasks(JSON.stringify(fixture.tasks),true);});
 assert.match(await page.locator('[data-task="t100"]').innerText(),/20%/);
 assert.match(await page.locator('#setup-stream-panel').innerText(),/New transfer issue/);
 checks.push('same ID/status numeric and error changes rerender cards');
 await page.evaluate(()=>{fixture.setup_progress.streams[0].completed_items=76;receiveTasks(JSON.stringify(fixture.tasks),true,fixture.setup_progress);});
 assert.match(await page.getByRole('tab',{name:/Wallpapers/}).innerText(),/76 \/ 85/);assert.equal(await badge().innerText(),'2147');
 checks.push('snapshot-only receiveTasks argument is not skipped');
 await page.evaluate(()=>receiveTasks(JSON.stringify(fixture.tasks),false));assert.match(await page.locator('.task-summary').innerText(),/Offline/);
 await page.evaluate(()=>receiveTasks(JSON.stringify(fixture.tasks),true));assert.match(await page.locator('.task-summary').innerText(),/Connected; some transfers will retry/);
 checks.push('online-only callback updates connection wording');
 await page.evaluate(()=>{fixture.setup_progress.streams.forEach(s=>{s.completed_items=s.total_items;s.completed_bytes=s.total_bytes;s.complete=true});fixture.setup_progress.complete=true;fixture.tasks=[];receiveState(JSON.stringify(fixture));});
 await home();assert.equal(await page.locator('[data-home-pending]').innerText(),'0');assert.match(await page.locator('[data-home-task-label]').innerText(),/Needs attention/);
 assert.equal(await badge().innerText(),'!');assert(await badge().isVisible());assert(!(await page.locator('#workspace-page').innerText()).includes('All tasks complete'));
 await page.evaluate(()=>{fixture.sync_error=null;receiveState(JSON.stringify(fixture));});
 assert.equal(await page.locator('[data-home-task-label]').innerText(),'All tasks complete');assert(await badge().isHidden());
 await page.evaluate(()=>{fixture.tasks=[{id:'failure',action:'profile',status:'failed',title:'Save failed',error:'Try manually'}];receiveTasks(JSON.stringify(fixture.tasks),true);});
 assert.match(await page.locator('[data-home-task-label]').innerText(),/Needs attention/);assert(await badge().isVisible());
 checks.push('error or failure preserves attention and only clean full totals show complete');
 await page.evaluate(()=>{delete fixture.setup_progress;fixture.tasks=Array.from({length:150},(_,i)=>({id:'recent'+i,action:'profile',title:'Recent task '+i,status:i<100?'done':'queued'}));receiveState(JSON.stringify(fixture));});
 assert.equal(await page.locator('[data-home-pending]').innerText(),'50');assert.equal(await page.locator('[data-home-task-label]').innerText(),'Recent tasks');assert.equal(await badge().innerText(),'50 recent');
 await downloads();assert.equal(await page.locator('[data-download-pending]').innerText(),'50 recent tasks pending');
 await tasks();assert.match(await page.locator('.task-summary').innerText(),/Recent tasks/);assert.match(await page.locator('#setup-stream-panel').innerText(),/Full-catalog.*not available/s);
 assert(!(await page.locator('#setup-stream-panel').innerText()).includes('Catalog progress above includes all items'));
 checks.push('missing totals label limited Recent tasks everywhere');
 for(const invalid of [{catalog_known:false,streams:[]},{catalog_known:true,streams:[{kind:'wallpaper',total_items:1,completed_items:2}]},{catalog_known:true,streams:[{kind:'wallpaper',total_items:1,completed_items:0},{kind:'wallpaper',total_items:1,completed_items:0},{kind:'resource',total_items:1,completed_items:0}]}]){
  await page.evaluate(value=>{fixture.setup_progress=value;receiveState(JSON.stringify(fixture));},invalid);assert.equal(await badge().innerText(),'50 recent');
 }
 checks.push('unknown malformed or duplicate streams cannot invent totals');
 await page.evaluate(()=>{fixture.tasks=[];fixture.sync_error='Earlier sync issue';receiveState(JSON.stringify(fixture));});await home();
 assert.match(await page.locator('[data-home-task-label]').innerText(),/Recent tasks.*Needs attention/);assert(!(await page.locator('#workspace-page').innerText()).includes('All tasks complete'));
 checks.push('empty recent history is not proof of completion');
 return checks;
}
