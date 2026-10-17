using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PrimeSecureSetup {
    public sealed class CommandResult {
        public int Code; public string Output;
        public CommandResult(int code,string output) { Code=code;Output=output??""; }
    }
    public interface IAdb {
        Task<CommandResult> Run(string[] args,string input,int seconds,CancellationToken cancel);
    }
    public sealed class AdbProcess : IAdb {
        readonly string executable,home;
        public AdbProcess(string executable,string home) { this.executable=executable;this.home=home;Directory.CreateDirectory(home); }
        public static string Quote(string value) {
            // Windows CommandLineToArgvW quoting; never invoke cmd.exe or PowerShell.
            var b=new StringBuilder("\"");int slashes=0;
            foreach(char c in value) {
                if(c=='\\') { slashes++;continue; }
                if(c=='"') { b.Append('\\',slashes*2+1);b.Append(c);slashes=0;continue; }
                b.Append('\\',slashes);slashes=0;b.Append(c);
            }
            b.Append('\\',slashes*2);return b.Append('"').ToString();
        }
        public async Task<CommandResult> Run(string[] args,string input,int seconds,CancellationToken cancel) {
            var info=new ProcessStartInfo(executable,String.Join(" ",new[]{"-P","5047"}.Concat(args).Select(Quote))) {
                UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,
                WorkingDirectory=Path.GetDirectoryName(executable)
            };
            // Keep the operator's pairing key off removable media and isolate it from other ADB versions.
            info.EnvironmentVariables["ANDROID_USER_HOME"]=home;
            info.EnvironmentVariables["ADB_MDNS_OPENSCREEN"]="1";
            using(var p=new Process { StartInfo=info }) {
                p.Start();var output=p.StandardOutput.ReadToEndAsync();var errors=p.StandardError.ReadToEndAsync();
                if(input!=null)await p.StandardInput.WriteLineAsync(input);p.StandardInput.Close();
                var wait=Task.Run(()=>p.WaitForExit());
                var timeout=Task.Delay(TimeSpan.FromSeconds(seconds),cancel);
                if(await Task.WhenAny(wait,timeout)!=wait) {
                    try { p.Kill(); } catch(InvalidOperationException) {}
                    await wait;cancel.ThrowIfCancellationRequested();throw new TimeoutException("The device did not answer in time. Keep it unlocked and check Wi-Fi/debugging, then retry.");
                }
                cancel.ThrowIfCancellationRequested();return new CommandResult(p.ExitCode,(await output)+"\n"+(await errors));
            }
        }
    }
    public sealed class Device {
        public string Serial,State,Model;
        public override string ToString() { return (String.IsNullOrEmpty(Model)?Serial:Model+"  -  "+Serial)+"  ("+State+")"; }
    }
    public sealed class SetupOutcome {
        public bool AlreadyEnrolled;public string Message;public string HardwareSerial;
    }
    public sealed class SetupEngine {
        public const string Package="com.robokorda.primesecure";
        public const string Receiver=Package+"/.AdminReceiver";
        readonly IAdb adb;readonly Action<int,string> progress;readonly Action<string> log;
        public Func<int,CancellationToken,Task> Delay=(ms,c)=>Task.Delay(ms,c);
        public int EnrollmentPolls=45;
        public SetupEngine(IAdb adb,Action<int,string> progress,Action<string> log) { this.adb=adb;this.progress=progress;this.log=log; }
        public static string EnrollmentKey(string input) {
            string key=Regex.Replace(input.ToUpperInvariant(),"[\\s-]","").Replace('O','0').Replace('I','1').Replace('L','1');
            if(!Regex.IsMatch(key,"^[0-9A-HJKMNP-TV-Z]{8}$"))throw new ArgumentException("Enter the eight-character school enrollment key.");
            return key.Substring(0,4)+"-"+key.Substring(4);
        }
        public static string Endpoint(string input) {
            var m=Regex.Match(input.Trim(),@"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$");IPAddress ip;int port;
            if(!m.Success||!IPAddress.TryParse(m.Groups[1].Value,out ip)||!Int32.TryParse(m.Groups[2].Value,out port)||port<1||port>65535)
                throw new ArgumentException("Use the IPv4 address and port shown by Wireless debugging, for example 192.168.1.20:37895.");
            return ip+":"+port;
        }
        public static void Serial(string serial) {
            if(String.IsNullOrEmpty(serial)||!Regex.IsMatch(serial,@"^[A-Za-z0-9_.:\[\]-]+$"))throw new ArgumentException("Select a connected Primebook first.");
        }
        public static List<Device> Devices(string output) {
            var list=new List<Device>();
            foreach(string line in output.Split('\n')) {
                var m=Regex.Match(line.Trim(),@"^(\S+)\s+(device|offline|unauthorized|recovery|sideload)\b(.*)$");if(!m.Success)continue;
                if(!Regex.IsMatch(m.Groups[1].Value,@"^[A-Za-z0-9_.:\[\]-]+$"))continue;
                var model=Regex.Match(m.Groups[3].Value,@"\bmodel:(\S+)");
                list.Add(new Device { Serial=m.Groups[1].Value,State=m.Groups[2].Value,Model=model.Success?model.Groups[1].Value.Replace('_',' '):"" });
            }
            return list;
        }
        public static string Owner(string output) {
            var section=Regex.Match(output,@"(?im)^\s*Device Owner\s*:\s*(.*)$");
            if(!section.Success)return null;
            string text=output.Substring(section.Index,Math.Min(1200,output.Length-section.Index));
            if(Regex.IsMatch(section.Groups[1].Value.Trim(),@"^(null|none)$",RegexOptions.IgnoreCase))return null;
            var owner=Regex.Match(text,@"admin\s*=\s*ComponentInfo\{([A-Za-z0-9_.]+)/[A-Za-z0-9_.$]+\}");
            if(owner.Success)return owner.Groups[1].Value;
            throw new InvalidOperationException("The device owner format could not be verified on this firmware. No ownership change was attempted.");
        }
        public static string Foreground(string output) {
            var m=Regex.Match(output,@"(?:mResumedActivity|topResumedActivity|ResumedActivity):?\s*[^\r\n]*?com\.robokorda\.primesecure/(\.?[A-Za-z0-9_.]+)");
            return m.Success?m.Groups[1].Value.Split('.').Last():"";
        }
        public static string Failure(string output) {
            if(output.Contains("UPDATE_INCOMPATIBLE"))return "A different signing key is already installed. This kit will not uninstall it or erase its data.";
            if(output.Contains("VERSION_DOWNGRADE"))return "A newer PrimeSecure APK is already installed. Use a newer setup kit; downgrading is not attempted.";
            if(output.Contains("TEST_ONLY"))return "Android reports a test-only APK. Stop and use the verified release kit.";
            if(output.IndexOf("accounts",StringComparison.OrdinalIgnoreCase)>=0)return "Android refused Device Owner because accounts are present. Remove accounts through Settings, then retry. The tool does not reset devices.";
            if(output.IndexOf("already",StringComparison.OrdinalIgnoreCase)>=0&&output.IndexOf("owner",StringComparison.OrdinalIgnoreCase)>=0)return "Another device owner or an incompatible management state already exists. No administrator is removed automatically.";
            if(output.IndexOf("unauthorized",StringComparison.OrdinalIgnoreCase)>=0)return "Approve debugging on the unlocked Primebook, then reconnect.";
            if(output.IndexOf("offline",StringComparison.OrdinalIgnoreCase)>=0||output.IndexOf("not found",StringComparison.OrdinalIgnoreCase)>=0)return "The selected Primebook disconnected. Recheck Wireless debugging's connection port and reconnect.";
            if(output.IndexOf("Unknown command",StringComparison.OrdinalIgnoreCase)>=0)return "This PrimeOS build does not support the requested Android setup command. Keep this result for the pilot review.";
            return "Android did not complete this step. Check the unlocked Primebook and retry. The details below are redacted.";
        }
        async Task<CommandResult> DeviceCommand(string serial,CancellationToken c,int timeout,params string[] args) {
            Serial(serial);return await adb.Run(new[]{"-s",serial}.Concat(args).ToArray(),null,timeout,c);
        }
        void Require(CommandResult result,string stage,string secret) {
            if(result.Code==0&&!Regex.IsMatch(result.Output,@"(?im)^\s*(Error:|Exception|Failure\s*\[)"))return;
            string safe=String.IsNullOrEmpty(secret)?result.Output:result.Output.Replace(secret,"[enrollment key]").Replace(secret.Replace("-",""),"[enrollment key]");
            log(stage+": "+safe.Trim().Substring(0,Math.Min(1600,safe.Trim().Length)));throw new InvalidOperationException(Failure(result.Output));
        }
        public async Task<List<Device>> Refresh(CancellationToken c) {
            var result=await adb.Run(new[]{"devices","-l"},null,20,c);if(result.Code!=0)throw new InvalidOperationException("Could not start the bundled connection tool.");return Devices(result.Output);
        }
        public async Task Pair(string endpoint,string code,CancellationToken c) {
            endpoint=Endpoint(endpoint);if(!Regex.IsMatch(code.Trim(),@"^\d{6}$"))throw new ArgumentException("Enter the six-digit pairing code displayed on the Primebook.");
            var result=await adb.Run(new[]{"pair",endpoint},code.Trim(),35,c);
            if(result.Code!=0||result.Output.IndexOf("Successfully paired",StringComparison.OrdinalIgnoreCase)<0)throw new InvalidOperationException("Pairing was not accepted. Keep the pairing-code window open and use its current address/code; then retry.");
            log("Debugging pairing accepted.");
        }
        public async Task<string> DiscoverConnection(string pairedEndpoint,CancellationToken c) {
            string host=Endpoint(pairedEndpoint).Split(':')[0];var result=await adb.Run(new[]{"mdns","services"},null,12,c);
            var matches=Regex.Matches(result.Output,@"_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)").Cast<Match>()
                .Select(m=>m.Groups[1].Value).Where(s=>s.StartsWith(host+":",StringComparison.Ordinal)).Distinct().ToArray();
            return matches.Length==1?Endpoint(matches[0]):null;
        }
        public async Task Connect(string endpoint,CancellationToken c) {
            endpoint=Endpoint(endpoint);var result=await adb.Run(new[]{"connect",endpoint},null,25,c);
            if(result.Code!=0||(!result.Output.Contains("connected to "+endpoint)&&!result.Output.Contains("already connected to "+endpoint)))throw new InvalidOperationException("Connection failed. Use the connection address on Wireless debugging's main screen, not the pairing address. Keep the PC and Primebook on the same Wi-Fi; school Wi-Fi may block communication between devices.");
        }
        public static string Hash(string path) { using(var stream=File.OpenRead(path))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
        public async Task<SetupOutcome> Prepare(string serial,string token,string apk,string expectedHash,CancellationToken c,bool manual=false) {
            Serial(serial);string key=manual?"":EnrollmentKey(token);
            progress(0,"Verifying the APK and selected Primebook");
            if(Hash(apk)!=expectedHash)throw new InvalidOperationException("The APK checksum differs from this kit. Extract a fresh kit; do not install this file.");
            var device=(await Refresh(c)).SingleOrDefault(d=>d.Serial==serial);
            if(device==null||device.State!="device")throw new InvalidOperationException("The selected device is not ready. Unlock it, authorize debugging, then reconnect.");
            var user=await DeviceCommand(serial,c,15,"shell","am","get-current-user");Require(user,"Current user",key);
            if(user.Output.Trim()!="0")throw new InvalidOperationException("Switch to the Primebook's main user before provisioning. Guest and secondary users cannot be used.");
            var api=await DeviceCommand(serial,c,15,"shell","getprop","ro.build.version.sdk");int sdk;
            if(api.Code!=0||!Int32.TryParse(api.Output.Trim(),out sdk)||sdk<26)throw new InvalidOperationException("PrimeSecure requires Android 8 or newer. The Android version could not be verified.");
            var policies=await DeviceCommand(serial,c,20,"shell","dumpsys","device_policy");Require(policies,"Management state",key);string owner=Owner(policies.Output);
            if(owner!=null&&owner!=Package)throw new InvalidOperationException("This Primebook is already managed by "+owner+". An authorized ownership transfer is required; no administrator was removed.");
            progress(1,"Installing PrimeSecure "+Kit.VersionName);
            var install=await DeviceCommand(serial,c,240,"install","-r",apk);
            if(install.Code!=0||!Regex.IsMatch(install.Output,@"(?m)^\s*Success\s*$")) {
                // One bounded transport fallback. Never uninstall, use -t, or force a downgrade.
                if(!Regex.IsMatch(install.Output,"INSTALL_PARSE_FAILED_NOT_APK|INSTALL_FAILED_INVALID_APK|failed[^\\r\\n]*stream|stream[^\\r\\n]*failed|connection reset|protocol fault",RegexOptions.IgnoreCase)) {
                    log("Install failed: "+install.Output.Trim());throw new InvalidOperationException(Failure(install.Output));
                }
                log("Streaming install failed; retrying through Android's staged installer.");
                string remote="/data/local/tmp/primesecure-setup-"+Guid.NewGuid().ToString("N")+".apk";
                Exception stagedError=null;
                try {
                    var push=await DeviceCommand(serial,c,240,"push",apk,remote);Require(push,"Staged transfer",key);
                    var hash=await DeviceCommand(serial,c,20,"shell","sha256sum",remote);Require(hash,"Transferred APK checksum",key);
                    if(!hash.Output.StartsWith(expectedHash,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("The transferred APK checksum does not match. Check the connection; installation stopped.");
                    install=await DeviceCommand(serial,c,120,"shell","pm","install","-r",remote);Require(install,"Staged install",key);
                    if(!Regex.IsMatch(install.Output,@"(?m)^\s*Success\s*$"))throw new InvalidOperationException(Failure(install.Output));
                } catch(Exception error) { stagedError=error; }
                try { await DeviceCommand(serial,CancellationToken.None,10,"shell","rm","-f",remote); }catch(Exception){}
                if(stagedError!=null)System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(stagedError).Throw();
            }
            log("Verified release APK installed.");
            progress(2,"Authorizing school device management");
            if(owner!=Package) {
                var owned=await DeviceCommand(serial,c,30,"shell","dpm","set-device-owner",Receiver);Require(owned,"Device Owner",key);
                if(!Regex.IsMatch(owned.Output,@"Success:.*Device owner",RegexOptions.IgnoreCase))throw new InvalidOperationException("Android did not confirm Device Owner. No reset or setup-flag bypass was attempted.");
            }
            var verification=await DeviceCommand(serial,c,20,"shell","dumpsys","device_policy");Require(verification,"Owner verification",key);
            if(Owner(verification.Output)!=Package)throw new InvalidOperationException("Device Owner could not be independently verified. Do not enroll until Android reports PrimeSecure as owner.");
            log("Android confirms PrimeSecure is Device Owner.");
            progress(3,"Granting school media access");
            var access=await DeviceCommand(serial,c,20,"shell","appops","set",Package,"MANAGE_EXTERNAL_STORAGE","allow");
            if(access.Code!=0||Regex.IsMatch(access.Output,@"(?im)^\s*(Error|Exception)"))log("Media access needs confirmation on the Primebook's setup screen.");else log("Media-access request accepted.");
            progress(4,"Opening PrimeSecure and checking existing enrollment");
            var opened=await DeviceCommand(serial,c,25,"shell","am","start","-W","-n",Package+"/.MainActivity");Require(opened,"Open PrimeSecure",key);
            await Delay(1600,c);
            var activity=await DeviceCommand(serial,c,15,"shell","dumpsys","activity","activities");Require(activity,"Read app state",key);
            string foreground=Foreground(activity.Output);
            if(new[]{"HubActivity","SetupActivity","LockActivity","MessageActivity"}.Contains(foreground))return new SetupOutcome { AlreadyEnrolled=true,Message="This Primebook is already enrolled. Its existing student assignment was kept; the entered key was not submitted. Check its student record in the dashboard." };
            if(foreground!="MainActivity")throw new InvalidOperationException("PrimeSecure is not visible yet. Unlock the Primebook, reopen it, then retry. The enrollment key has not been submitted.");
            if(manual) {
                var hardware=await DeviceCommand(serial,c,15,"shell","getprop","ro.serialno");Require(hardware,"Hardware identity",key);
                string identity=hardware.Output.Trim();
                if(String.IsNullOrWhiteSpace(identity)||identity=="unknown")throw new InvalidOperationException("The hardware serial could not be read. No student was created.");
                return new SetupOutcome { HardwareSerial=identity,Message="Primebook ready. Enter the displayed school key on the Primebook." };
            }
            progress(5,"Submitting the school enrollment key");
            opened=await DeviceCommand(serial,c,25,"shell","am","start","-W","-n",Package+"/.MainActivity","--es","token",key);Require(opened,"Start enrollment",key);
            for(int poll=0;poll<EnrollmentPolls;poll++) {
                c.ThrowIfCancellationRequested();await Delay(2000,c);
                activity=await DeviceCommand(serial,c,15,"shell","dumpsys","activity","activities");Require(activity,"Check enrollment",key);foreground=Foreground(activity.Output);
                if(new[]{"SetupActivity","HubActivity"}.Contains(foreground)) {
                    progress(6,"Enrollment confirmed - school preparation continues on the Primebook");
                    return new SetupOutcome { Message="Enrollment confirmed. Keep the Primebook online and plugged in. Its preparation screen installs required apps, wallpaper and starter notes; remaining downloads continue in Background tasks. Check the correct student appears online in the dashboard." };
                }
                if(poll==10)log("Waiting for the enrollment response. Check the Primebook screen for a network/key message.");
            }
            throw new InvalidOperationException("Enrollment is not confirmed. Device Owner and the APK remain installed. Read the message in PrimeSecure, check internet/key expiry, then retry with a valid key. The tool has not marked this device complete.");
        }
    }
}
