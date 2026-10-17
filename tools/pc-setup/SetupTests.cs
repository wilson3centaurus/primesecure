using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace PrimeSecureSetup {
    sealed class FakeAdb:IAdb {
        public readonly List<string[]> Calls=new List<string[]>();
        public string State="device",OwnerPackage=null,CurrentUser="0",InstallError=null;
        public bool Existing=false,BadTransferHash=false,OwnerRejected=false,EnrollSeen=false,SkipOwnerChange=false;
        public int FailInstallCount=0;
        public string ExpectedHash;
        public Task<CommandResult> Run(string[] args,string input,int seconds,CancellationToken c) {
            c.ThrowIfCancellationRequested();Calls.Add(args);
            string cmd=String.Join(" ",args);
            if(cmd=="devices -l")return Done(0,"List of devices attached\nSERIAL123 "+State+" product:primebook model:Primebook_WiFi transport_id:3\n");
            if(args[0]=="pair")return Done(0,"Successfully paired to "+args[1]+" [guid=adb-abc]");
            if(args[0]=="mdns")return Done(0,"List of discovered mdns services\nadb-a _adb-tls-connect._tcp 192.168.1.20:37001\nadb-b _adb-tls-connect._tcp 192.168.1.21:37002");
            if(args[0]=="connect")return Done(0,"connected to "+args[1]);
            if(args.Length<3||args[0]!="-s"||args[1]!="SERIAL123")throw new Exception("Wrong target: "+cmd);
            var a=args.Skip(2).ToArray();cmd=String.Join(" ",a);
            if(cmd=="shell am get-current-user")return Done(0,CurrentUser);
            if(cmd=="shell getprop ro.serialno")return Done(0,"PB-TEST-123");
            if(cmd=="shell getprop ro.build.version.sdk")return Done(0,"30");
            if(cmd=="shell dumpsys device_policy")return Done(0,"Current DevicePolicyManager state:\n"+(OwnerPackage==null?"  Enabled Device Admins (User 0):\n":"  Device Owner:\n    admin=ComponentInfo{"+OwnerPackage+"/"+OwnerPackage+".AdminReceiver}\n    User ID: 0\n"));
            if(a[0]=="install") { if(FailInstallCount++==0&&InstallError!=null)return Done(1,"Performing Streamed Install\nadb: failed to install: Failure ["+InstallError+"]");return Done(0,"Performing Streamed Install\nSuccess"); }
            if(a[0]=="push")return Done(0,"1 file pushed");
            if(cmd.StartsWith("shell sha256sum "))return Done(0,(BadTransferHash?new String('0',64):ExpectedHash)+"  "+a.Last());
            if(cmd.StartsWith("shell pm install -r "))return Done(0,"Success");
            if(cmd.StartsWith("shell rm -f /data/local/tmp/primesecure-setup-"))return Done(0,"");
            if(cmd=="shell dpm set-device-owner "+SetupEngine.Receiver) {
                if(OwnerRejected)return Done(0,"Error: Not allowed to set the device owner because there are already some accounts on the device.");
                if(!SkipOwnerChange)OwnerPackage=SetupEngine.Package;return Done(0,"Success: Device owner set to package "+SetupEngine.Receiver);
            }
            if(cmd=="shell appops set "+SetupEngine.Package+" GET_USAGE_STATS allow")return Done(0,"");
            if(cmd=="shell appops set "+SetupEngine.Package+" MANAGE_EXTERNAL_STORAGE allow")return Done(0,"");
            if(cmd.StartsWith("shell am start -W -n "+SetupEngine.Package+"/.MainActivity")) { if(a.Contains("token"))EnrollSeen=true;return Done(0,"Starting: Intent { cmp="+SetupEngine.Package+"/.MainActivity (has extras) }"); }
            if(cmd=="shell dumpsys activity activities")return Done(0,"  mResumedActivity: ActivityRecord{123 u0 "+SetupEngine.Package+"/."+(Existing?"HubActivity":EnrollSeen?"SetupActivity":"MainActivity")+" t3}");
            throw new Exception("Unexpected command: "+cmd);
        }
        static Task<CommandResult> Done(int code,string value) { return Task.FromResult(new CommandResult(code,value)); }
    }
    static class SetupTests {
        static int passed;
        static void Check(bool condition,string message) { if(!condition)throw new Exception(message); }
        static void Test(string name,Action action) { action();passed++;Console.WriteLine("PASS "+name); }
        static void Throws(Action action,string expected) { try{action();}catch(Exception e){Check(e.Message.IndexOf(expected,StringComparison.OrdinalIgnoreCase)>=0,"Wrong failure: "+e.Message);return;}throw new Exception("Expected failure: "+expected); }
        static SetupOutcome Run(FakeAdb fake,string apk,List<string> logs,string token="ABCD-1234") {
            fake.ExpectedHash=SetupEngine.Hash(apk);var engine=new SetupEngine(fake,(i,s)=>logs.Add(s),s=>logs.Add(s));engine.Delay=(i,c)=>Task.FromResult(0);engine.EnrollmentPolls=1;
            return engine.Prepare("SERIAL123",token,apk,fake.ExpectedHash,CancellationToken.None).GetAwaiter().GetResult();
        }
        static int Main(string[] args) {
            try {
                if(args.Length>=3&&args[0]=="-P") {
                    if(args[2]=="probe-arguments") { Console.WriteLine(String.Join(";",args.Skip(3).Select(s=>Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s)))));return 0; }
                    if(args[2]=="probe-wait") { Thread.Sleep(15000);return 0; }
                    if(args[2]=="probe-input") { Console.WriteLine(Console.ReadLine());return 0; }
                }
                string apk=Path.Combine(args[0],"PrimeSecure.apk");
                Test("enrollment key normalization rejects command injection",()=>{Check(SetupEngine.EnrollmentKey("abcd 1234")=="ABCD-1234","format");foreach(string s in new[]{"abcd;1234","ab-1","ABCDEFGU","ABCD123456"})Throws(()=>SetupEngine.EnrollmentKey(s),"eight-character");});
                Test("pair endpoints are validated without shell execution",()=>{Check(SetupEngine.Endpoint("192.168.1.20:12345")=="192.168.1.20:12345","endpoint");foreach(string s in new[]{"1.2.3.4:0","999.1.1.1:12","192.168.1.20:42 & calc","host:123"})Throws(()=>SetupEngine.Endpoint(s),"IPv4");});
                Test("device parser keeps unauthorized devices visible but does not treat them ready",()=>{var d=SetupEngine.Devices("* daemon started successfully\nList of devices attached\nA device model:Primebook_WiFi\nB unauthorized\nC offline\n");Check(d.Count==3&&d[1].State=="unauthorized"&&d[0].Model=="Primebook WiFi","devices");});
                Test("device owner parser distinguishes an active admin and a real owner",()=>{Check(SetupEngine.Owner("Current DevicePolicyManager state:\nActive admin apps: ComponentInfo{other.owner/.Admin}")==null,"active admin mistaken for owner");Check(SetupEngine.Owner("Device Owner:\n admin=ComponentInfo{com.school.owner/.Admin}\n User ID: 0")=="com.school.owner","owner");Throws(()=>SetupEngine.Owner("Device Owner: unsupported vendor format"),"could not be verified");});
                Test("complete workflow targets one device and confirms app enrollment",()=>{var fake=new FakeAdb();var logs=new List<string>();var outcome=Run(fake,apk,logs);Check(!outcome.AlreadyEnrolled&&fake.EnrollSeen,"enrollment missing");Check(logs.Last().Contains("Enrollment confirmed"),"unconfirmed completion");Check(fake.Calls.All(a=>!a.Contains("-t")&&!a.Contains("wipe")&&!a.Contains("uninstall")&&!a.Contains("remove-active-admin")),"destructive fallback");Check(!String.Join("\n",logs).Contains("ABCD-1234"),"key logged");});
                Test("manual preparation opens key entry without sending a key or claiming enrollment",()=>{var fake=new FakeAdb();var engine=new SetupEngine(fake,(i,s)=>{},s=>{});engine.Delay=(i,c)=>Task.FromResult(0);var outcome=engine.Prepare("SERIAL123","",apk,SetupEngine.Hash(apk),CancellationToken.None,true).GetAwaiter().GetResult();Check(!fake.EnrollSeen&&!outcome.AlreadyEnrolled,"manual enrollment was submitted");Check(outcome.HardwareSerial=="PB-TEST-123","hardware identity missing");});
                Test("another owner prevents installation or ownership changes",()=>{var fake=new FakeAdb { OwnerPackage="com.other.mdm" };Throws(()=>Run(fake,apk,new List<string>()),"already managed");Check(!fake.Calls.Any(a=>a.Contains("install")||a.Contains("set-device-owner")),"mutation before ownership check");});
                Test("secondary users and unauthorized devices stop before installation",()=>{foreach(var fake in new[]{new FakeAdb{State="unauthorized"},new FakeAdb{CurrentUser="10"}}){Throws(()=>Run(fake,apk,new List<string>()),fake.State=="unauthorized"?"not ready":"main user");Check(!fake.Calls.Any(a=>a.Contains("install")),"install on ineligible device");}});
                Test("wrong-signature install is not retried or uninstalled",()=>{var fake=new FakeAdb { InstallError="INSTALL_FAILED_UPDATE_INCOMPATIBLE" };Throws(()=>Run(fake,apk,new List<string>()),"signing key");Check(!fake.Calls.Any(a=>a.Contains("push")||a.Contains("set-device-owner")||a.Contains("uninstall")),"unsafe install fallback");});
                Test("stream corruption has one checksum-verified staged transfer",()=>{var fake=new FakeAdb { InstallError="INSTALL_PARSE_FAILED_NOT_APK" };Run(fake,apk,new List<string>());Check(fake.Calls.Count(a=>a.Contains("push"))==1,"duplicate push");Check(fake.Calls.Any(a=>a.Contains("sha256sum"))&&fake.Calls.Any(a=>a.Contains("rm")),"missing checksum or cleanup");});
                Test("staged checksum mismatch prevents package install and cleans its file",()=>{var fake=new FakeAdb { InstallError="INSTALL_PARSE_FAILED_NOT_APK",BadTransferHash=true };Throws(()=>Run(fake,apk,new List<string>()),"checksum does not match");Check(!fake.Calls.Any(a=>a.Contains("pm")&&a.Contains("install")),"corrupt install");Check(fake.Calls.Any(a=>a.Contains("rm")),"staged file not cleaned");});
                Test("Device Owner rejection is not reported as completion",()=>{var fake=new FakeAdb { OwnerRejected=true };Throws(()=>Run(fake,apk,new List<string>()),"accounts are present");Check(!fake.EnrollSeen,"enrolled after rejection");});
                Test("success-looking ownership output still needs independent confirmation",()=>{var fake=new FakeAdb { SkipOwnerChange=true };Throws(()=>Run(fake,apk,new List<string>()),"independently verified");Check(!fake.EnrollSeen,"enrolled without verification");});
                Test("existing enrollment keeps its student and does not submit another key",()=>{var fake=new FakeAdb { OwnerPackage=SetupEngine.Package,Existing=true };Check(Run(fake,apk,new List<string>()).AlreadyEnrolled,"existing enrollment");Check(!fake.EnrollSeen,"reassigned student");});
                Test("mDNS discovery selects only the paired address",()=>{var engine=new SetupEngine(new FakeAdb(),(i,s)=>{},s=>{});Check(engine.DiscoverConnection("192.168.1.20:9999",CancellationToken.None).Result=="192.168.1.20:37001","wrong device discovered");Check(engine.DiscoverConnection("192.168.1.22:9999",CancellationToken.None).Result==null,"guessed a device");});
                Test("bundle hashes match the compiled kit",()=>{foreach(var item in Kit.Files)Check(SetupEngine.Hash(Path.Combine(args[0],item.Key))==item.Value,"mismatch: "+item.Key);});
                var probe=new AdbProcess(System.Reflection.Assembly.GetExecutingAssembly().Location,Path.GetTempPath());
                Test("Windows argument quoting preserves spaces quotes empty and trailing-slash arguments",()=>{
                    var originals=new[]{"C:\\School setup\\PrimeSecure.apk","C:\\trailing slash\\","quoted\"value","","x & y"};
                    var result=probe.Run(new[]{"probe-arguments"}.Concat(originals).ToArray(),null,10,CancellationToken.None).GetAwaiter().GetResult();
                    Check(result.Code==0,"probe exit");var actual=result.Output.Trim().Split(';').Select(s=>System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(s))).ToArray();Check(actual.SequenceEqual(originals),"Windows changed arguments");
                });
                Test("pairing input travels over standard input",()=>{var result=probe.Run(new[]{"probe-input"},"654321",10,CancellationToken.None).GetAwaiter().GetResult();Check(result.Code==0&&result.Output.Trim()=="654321","stdin");});
                Test("a stuck executable is terminated on timeout",()=>{var timer=System.Diagnostics.Stopwatch.StartNew();Throws(()=>probe.Run(new[]{"probe-wait"},null,1,CancellationToken.None).GetAwaiter().GetResult(),"did not answer");Check(timer.Elapsed.TotalSeconds<5,"timeout did not stop process");});
                Test("packaged Windows connection executable launches with its bundled libraries",()=>{
                    var live=new AdbProcess(Path.Combine(args[0],"tools","adb.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"RoboKorda","PrimeSecure Setup","android"));
                    var version=live.Run(new[]{"version"},null,15,CancellationToken.None).GetAwaiter().GetResult();Check(version.Code==0&&version.Output.Contains("Android Debug Bridge"),"bundled executable did not run");
                    var list=live.Run(new[]{"devices","-l"},null,20,CancellationToken.None).GetAwaiter().GetResult();Check(list.Code==0&&list.Output.Contains("List of devices attached"),"isolated connection server failed");
                    live.Run(new[]{"kill-server"},null,10,CancellationToken.None).GetAwaiter().GetResult();
                });
                Console.WriteLine("Passed "+passed+" setup checks; physical PrimeOS provisioning remains unverified.");return 0;
            } catch(Exception e) { Console.Error.WriteLine(e);return 1; }
        }
    }
}
