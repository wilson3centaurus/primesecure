using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace PrimeSecureSetup {
 public sealed class School { public string id,name;public override string ToString(){return name;} }
 public sealed class SchoolClass { public string form_level,class_name;public override string ToString(){return form_level+" / "+class_name;} }
 public sealed class PendingStudent { public string id,school_id,student_name,enroll_token,status,enrolled_at,auth_user_id,serial,student_id; }
 public sealed class ClassCache { public string saved_at;public SchoolClass[] classes; }
 public sealed class SetupCloud : IDisposable {
  readonly HttpClient http;readonly JavaScriptSerializer json=new JavaScriptSerializer();readonly string cacheRoot;string access,refresh,user;DateTime expires;public bool CachedClasses;public string CacheDate;
  public SetupCloud(string cacheRoot,HttpMessageHandler handler=null){this.cacheRoot=cacheRoot;http=handler==null?new HttpClient(new HttpClientHandler{AllowAutoRedirect=false}):new HttpClient(handler);http.Timeout=TimeSpan.FromSeconds(20);ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;}
  async Task<string> Send(string path,HttpMethod method,object body,CancellationToken c,bool auth=true){
   if(auth){if(String.IsNullOrEmpty(access))throw new InvalidOperationException("Sign in with your school administrator account.");if(DateTime.UtcNow>=expires)await Renew(c);}
   using(var request=new HttpRequestMessage(method,Kit.ApiUrl+path)){
    request.Headers.Add("apikey",Kit.AnonKey);if(auth)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",access);
    if(path.StartsWith("/rest/v1/devices")&&method==HttpMethod.Post)request.Headers.Add("Prefer","return=representation");
    if(body!=null)request.Content=new StringContent(json.Serialize(body),Encoding.UTF8,"application/json");
    using(var response=await http.SendAsync(request,c)){string text=await response.Content.ReadAsStringAsync();if(!response.IsSuccessStatusCode){if(response.StatusCode==HttpStatusCode.Unauthorized)throw new InvalidOperationException("Your session expired or sign-in was refused. Sign in again; the pending student is kept.");if(response.StatusCode==HttpStatusCode.Forbidden)throw new InvalidOperationException("School administrator access is required.");throw new InvalidOperationException("The server could not complete this request ("+(int)response.StatusCode+"). Check your connection and retry; no duplicate student will be created.");}return text;}
   }
  }
  public sealed class AuthUser{public string id {get;set;}} public sealed class Session{public string access_token {get;set;} public string refresh_token {get;set;} public int expires_in {get;set;} public AuthUser user {get;set;}}
  public sealed class Profile{public string role {get;set;}}
  void SetSession(string text){var s=json.Deserialize<Session>(text);if(s==null||s.user==null||String.IsNullOrEmpty(s.access_token)||String.IsNullOrEmpty(s.refresh_token))throw new InvalidOperationException("Sign-in response was incomplete.");access=s.access_token;refresh=s.refresh_token;user=s.user.id;expires=DateTime.UtcNow.AddSeconds(Math.Max(1,s.expires_in-60));}
  async Task Renew(CancellationToken c){SetSession(await Send("/auth/v1/token?grant_type=refresh_token",HttpMethod.Post,new{refresh_token=refresh},c,false));}
  public async Task<School[]> SignIn(string email,string password,CancellationToken c){
   access=refresh=user=null;
   try{SetSession(await Send("/auth/v1/token?grant_type=password",HttpMethod.Post,new{email=email.Trim(),password=password},c,false));var profiles=json.Deserialize<Profile[]>(await Send("/rest/v1/profiles?select=role&id=eq."+Uri.EscapeDataString(user),HttpMethod.Get,null,c));if(profiles.Length!=1||!(new[]{"super_admin","school_admin"}).Contains(profiles[0].role))throw new InvalidOperationException("Use a school administrator account. Student and teacher accounts cannot enroll devices.");return json.Deserialize<School[]>(await Send("/rest/v1/schools?select=id,name&order=name",HttpMethod.Get,null,c));}catch{access=refresh=user=null;throw;}
  }
  string CacheFile(string school){Guid.Parse(school);Guid.Parse(user);return Path.Combine(cacheRoot,user+"-"+school+"-classes.json");}
  async Task<SchoolClass[]> FreshClasses(string school,CancellationToken c){Guid.Parse(school);return json.Deserialize<SchoolClass[]>(await Send("/rest/v1/school_classes?select=form_level,class_name&school_id=eq."+school+"&order=form_level,class_name&limit=1000",HttpMethod.Get,null,c));}
  public async Task<SchoolClass[]> Classes(string school,CancellationToken c){
   CachedClasses=false;try{var list=await FreshClasses(school,c);CacheDate=DateTime.UtcNow.ToString("o");try{Directory.CreateDirectory(cacheRoot);File.WriteAllText(CacheFile(school),json.Serialize(new ClassCache{saved_at=CacheDate,classes=list}));}catch(IOException){}catch(UnauthorizedAccessException){}return list;}
   catch(HttpRequestException){return ReadCache(school);}catch(TaskCanceledException){c.ThrowIfCancellationRequested();return ReadCache(school);}
  }
  SchoolClass[] ReadCache(string school){var file=CacheFile(school);if(!File.Exists(file))throw new InvalidOperationException("Classes could not be downloaded and no saved class list is available. Reconnect and refresh.");var cache=json.Deserialize<ClassCache>(File.ReadAllText(file));CachedClasses=true;CacheDate=cache.saved_at;return cache.classes??new SchoolClass[0];}
  public async Task<PendingStudent> Find(string school,string id,CancellationToken c){Guid.Parse(id);Guid.Parse(school);var rows=json.Deserialize<PendingStudent[]>(await Send("/rest/v1/devices?select=id,school_id,student_name,student_id,enroll_token,status,enrolled_at,auth_user_id,serial&id=eq."+id+"&school_id=eq."+school,HttpMethod.Get,null,c));var result=rows.SingleOrDefault();if(result!=null&&(result.id!=id||result.school_id!=school))throw new InvalidOperationException("The server returned a different student or school. Enrollment stopped.");return result;}
  public async Task<PendingStudent> Create(string school,string id,string name,SchoolClass klass,CancellationToken c){
   Guid.Parse(school);Guid.Parse(id);name=name.Trim();if(name.Length<2||name.Length>160)throw new InvalidOperationException("Enter the student's real name (2 to 160 characters).");if(klass==null||String.IsNullOrWhiteSpace(klass.class_name))throw new InvalidOperationException("Select a form and class from the school library.");
   var existing=await Find(school,id,c);if(existing!=null)return existing;
   var current=await FreshClasses(school,c);if(!current.Any(k=>k.form_level==klass.form_level&&k.class_name==klass.class_name))throw new InvalidOperationException("This class was removed or changed. Refresh the school classes before continuing.");
   var result=json.Deserialize<PendingStudent[]>(await Send("/rest/v1/devices?select=id,school_id,student_name,student_id,enroll_token,status,enrolled_at,auth_user_id,serial",HttpMethod.Post,new{id=id,school_id=school,student_name=name,form_level=klass.form_level,class_name=klass.class_name},c));return result.Single();
  }
  public static bool Confirmed(PendingStudent student,string hardware){if(student==null||student.status=="pending"||String.IsNullOrEmpty(student.enrolled_at)||String.IsNullOrEmpty(student.auth_user_id))return false;if(!String.Equals(student.serial,hardware,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("The key was used on a different Primebook. Check the student record; this device is not confirmed.");return true;}
  public void Dispose(){access=refresh=user=null;http.Dispose();}
 }
}
