const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const entry=JSON.parse(fs.readFileSync(process.argv[2])), bytes=fs.readFileSync(process.argv[3]);
if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.index.sha256)throw Error('Repository index checksum mismatch');
if(Date.now()-entry.timestamp>14*86400000)throw Error('Repository snapshot is too old');
const index=JSON.parse(bytes), english=v=>v?.['en-US']||v?.['en-GB']||Object.values(v||{})[0];
const featured=['org.videolan.vlc','org.geogebra.android.gcas','org.geogebra.android.calculator.suite','org.kde.kdeconnect_tp','org.kiwix.kiwixmobile','org.librera','com.foobnix.pro.pdf.reader','org.mozilla.fennec_fdroid','org.fossify.gallery','org.fossify.musicplayer','org.fossify.notes','org.fossify.calendar','com.termux','com.minar.birday','org.documentfoundation.libreoffice','com.artifex.mupdf.viewer.app','org.pocketworkstation.pckeyboard','org.schabi.newpipe','com.duy.calculator.free','org.secuso.privacyfriendlycalculator'];
const apps=[];
for(const [id,p] of Object.entries(index.packages)) {
 const versions=Object.values(p.versions).filter(v=>v.manifest.usesSdk?.minSdkVersion<=30 && !v.manifest.usesSdk?.maxSdkVersion && v.file.size<=150000000 && (!(v.manifest.nativecode?.length) || v.manifest.nativecode.includes('armeabi-v7a')) && !(v.releaseChannels?.length));
 versions.sort((a,b)=>b.manifest.versionCode-a.manifest.versionCode);const version=versions[0];if(!version)continue;
 const m=p.metadata,icon=english(m.icon);
 apps.push({id,title:String(english(m.name)||id),description:String(english(m.summary)||'').replace(/<[^>]*>/g,'').slice(0,240),category:m.categories?.[0]||'Other',icon:icon?.name?'https://f-droid.org/repo'+icon.name:null,iconHash:icon?.sha256||null,apk:'https://f-droid.org/repo'+version.file.name,sha256:version.file.sha256,size:version.file.size,version:version.manifest.versionName,minSdk:version.manifest.usesSdk?.minSdkVersion||1,featured:featured.includes(id)});
}
apps.sort((a,b)=>Number(b.featured)-Number(a.featured)||a.title.localeCompare(b.title));
const out=path.join(__dirname,'../dashboard/src/data/app-catalog.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({source:'F-Droid',timestamp:entry.timestamp,indexHash:entry.index.sha256,signer:'43238d512c1e5eb2d6569f4a3afbf5523418b82e0a3ed1552770abb9a9c9ccab',apps}));
console.log(`Published ${apps.length} catalog apps with verified repository hashes`);
