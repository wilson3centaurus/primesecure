// Bounded real-browser QA: two invalid uploads, no catalog entries published.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/XO/AppData/Local/Temp/primesecure-split-qa/node_modules/playwright');
const {zipSync,unzipSync,strToU8}=require('../../dashboard/node_modules/fflate');
const sessionPath=path.resolve('artifacts/split-upload-session.private.json'),qa=JSON.parse(fs.readFileSync(sessionPath,'utf8'));
(async()=>{
 const fixtures=path.resolve('artifacts/split-uploader-fixtures'),folder=path.join(fixtures,'Incomplete_App');fs.mkdirSync(folder,{recursive:true});
 const original=fs.readFileSync('C:/Users/XO/Desktop/Prime Secure/App Packages/Calculator/base.apk');
 const manifest=unzipSync(original,{filter:e=>e.name==='AndroidManifest.xml'})['AndroidManifest.xml'];
 const base=zipSync({'AndroidManifest.xml':manifest},{level:0});
 fs.writeFileSync(path.join(fixtures,'Calculator-base-only.apk'),base);
 fs.writeFileSync(path.join(folder,'base.apk'),base);
 fs.writeFileSync(path.join(folder,'split_config.en.apk'),zipSync({'not-a-manifest.txt':strToU8('deliberately invalid QA split')},{level:0}));
 const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[],paths=[];
 page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/library/publish'){try{const p=r.postDataJSON().path;if(p&&!paths.includes(p)){paths.push(p);qa.qaPaths=paths;fs.writeFileSync(sessionPath,JSON.stringify(qa));}}catch{}}});
 try{
  await page.goto('https://primesecure-beta.vercel.app/login');await page.getByLabel('Email',{exact:true}).fill(qa.email);await page.getByLabel('Password',{exact:true}).fill(qa.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/\/(overview|devices)$/);
  await page.goto('https://primesecure-beta.vercel.app/apps');await page.getByText('+ Upload an APK',{exact:false}).first().click().catch(()=>{});
  const picker=page.locator('input[type=file]').first(),checkbox=page.getByLabel('Upload app folder (base + splits)',{exact:true});
  await checkbox.check();await picker.setInputFiles(folder);
  let response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/library/publish'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Upload app folders',exact:true}).click();let answer=await response;assert.equal(answer.status(),422);assert.match((await answer.json()).error,/manifest/i);
  await checkbox.uncheck();await picker.setInputFiles(path.join(fixtures,'Calculator-base-only.apk'));
  response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/library/publish'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Upload files',exact:true}).click();answer=await response;assert.equal(answer.status(),422);assert.match((await answer.json()).error,/companion splits/);
  assert.deepEqual(errors,[]);assert.equal(paths.length,2);
  await page.screenshot({path:'artifacts/split-uploader-live.png',fullPage:true});
  console.log(JSON.stringify({browser:'Edge',login:true,folder_picker:true,packed_folder_transferred:true,invalid_split_rejected:true,base_only_rejected:true,catalog_rows_published:0,page_errors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
