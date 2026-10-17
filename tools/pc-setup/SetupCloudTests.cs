using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
namespace PrimeSecureSetup{
 sealed class FakeCloud:HttpMessageHandler{
  public bool Offline,Removed,LostReply,Teacher;public int Creates;public PendingStudent Student;readonly JavaScriptSerializer json=new JavaScriptSerializer();
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel){return Run(request);}
  async Task<HttpResponseMessage> Run(HttpRequestMessage r){string path=r.RequestUri.PathAndQuery;object data;
   if(path.Contains("/auth/v1/token"))data=new{access_token="qa-access",refresh_token="qa-refresh",expires_in=3600,user=new{id="00000000-0000-4000-8000-000000000001"}};
   else{if(r.Headers.Authorization==null||r.Headers.Authorization.Parameter!="qa-access")throw new Exception("missing staff session");
    if(path.Contains("profiles?"))data=new[]{new{role=Teacher?"teacher":"school_admin"}};
    else if(path.Contains("schools?"))data=new[]{new{id=CloudTests.School,name="School"}};
    else if(path.Contains("school_classes?")){if(Offline)throw new HttpRequestException("offline");data=Removed?new SchoolClass[0]:new[]{new SchoolClass{form_level="Form 2",class_name="A"}};}
    else if(path.Contains("rpc/staff_prepare_student")){
     Creates++;var input=json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(await r.Content.ReadAsStringAsync());Student=new PendingStudent{id=input["p_request_id"],school_id=input["p_school"],student_name=input["p_student_name"],enroll_token="ABCD-1234",status="pending"};if(LostReply){LostReply=false;throw new HttpRequestException("response lost");}data=Student;
    }else if(path.Contains("devices?"))data=Student==null?new PendingStudent[0]:new[]{Student};
    else throw new Exception("unexpected request: "+path);
   }
   return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(json.Serialize(data),Encoding.UTF8,"application/json")};
  }
 }
 static class CloudTests{
  public const string School="00000000-0000-4000-8000-000000000002",Device="00000000-0000-4000-8000-000000000003";
  static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
  static int Main(string[] args){string root=Path.Combine(Path.GetTempPath(),"primesecure-cloud-test-"+Guid.NewGuid().ToString("N"));try{
   var fake=new FakeCloud();using(var cloud=new SetupCloud(root,fake)){
    cloud.SignIn("admin@example.test","not-real",CancellationToken.None).GetAwaiter().GetResult();var list=cloud.Classes(School,CancellationToken.None).GetAwaiter().GetResult();Check(list.Length==1&&!cloud.CachedClasses,"class sync");fake.Offline=true;Check(cloud.Classes(School,CancellationToken.None).GetAwaiter().GetResult().Length==1&&cloud.CachedClasses,"cache fallback");fake.Offline=false;fake.Removed=true;
    try{cloud.Create(School,Device,"Student",list[0],CancellationToken.None).GetAwaiter().GetResult();throw new Exception("removed class accepted");}catch(InvalidOperationException){Check(fake.Creates==0,"record created using stale classes");}fake.Removed=false;fake.LostReply=true;
    try{cloud.Create(School,Device,"Student",list[0],CancellationToken.None).GetAwaiter().GetResult();throw new Exception("lost reply missing");}catch(HttpRequestException){}
    var pending=cloud.Create(School,Device,"Student",list[0],CancellationToken.None).GetAwaiter().GetResult();Check(fake.Creates==1&&pending.enroll_token=="ABCD-1234","retry duplicated student");Check(!SetupCloud.Confirmed(pending,"PB123"),"pending marked complete");pending.status="active";pending.auth_user_id="qa-user";pending.enrolled_at="2026-10-17T12:00:00Z";pending.serial="PB456";try{SetupCloud.Confirmed(pending,"PB123");throw new Exception("wrong hardware accepted");}catch(InvalidOperationException){}pending.serial="PB123";Check(SetupCloud.Confirmed(pending,"PB123"),"valid enrollment rejected");
   }
   using(var teacher=new SetupCloud(root,new FakeCloud{Teacher=true})){try{teacher.SignIn("teacher@example.test","not-real",CancellationToken.None).GetAwaiter().GetResult();throw new Exception("teacher accepted");}catch(InvalidOperationException){}}
   Console.WriteLine("PASS authenticated class sync, offline class cache, stale-class refusal, idempotent retry, pending-state check, hardware match and teacher rejection");return 0;
  }catch(Exception e){Console.Error.WriteLine(e);return 1;}finally{if(Directory.Exists(root))Directory.Delete(root,true);}}
 }
}
