using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PrimeSecureSetup {
 public sealed class SetupForm : Form {
  readonly Color purple=Color.FromArgb(87,64,196),muted=Color.FromArgb(100,116,139);
  readonly TextBox connection=new TextBox(),pairAddress=new TextBox(),pairCode=new TextBox(),key=new TextBox(),messages=new TextBox(),studentName=new TextBox();
  readonly ComboBox devices=new ComboBox(),schools=new ComboBox(),forms=new ComboBox(),classes=new ComboBox();
  readonly Label result=new Label(),phase=new Label(),classHint=new Label();readonly ProgressBar progressBar=new ProgressBar();
  readonly Button pair=new Button(),connect=new Button(),refresh=new Button(),prepare=new Button(),cancel=new Button(),next=new Button(),save=new Button(),signIn=new Button(),refreshClasses=new Button();
  readonly string root;readonly SetupEngine engine;readonly SetupCloud cloud;readonly bool preview;CancellationTokenSource running;bool kitValid,schoolLoading,completed;
  string pendingId,pendingSchool,boundDevice,hardware;SchoolClass[] classList=new SchoolClass[0];
  readonly List<string> sessionLog=new List<string>();
  public bool IsWorking {get{return running!=null;}}
  public string DiagnosticState {get{return "Kit verified: "+kitValid+"\r\nPrepare enabled: "+prepare.Enabled+"\r\nBusy: "+IsWorking+"\r\nStatus: "+result.Text;}}
  public SetupForm(string root,bool preview){
   this.root=root;this.preview=preview;
   engine=new SetupEngine(new AdbProcess(Path.Combine(root,"tools","adb.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"RoboKorda","PrimeSecure Setup","android")),Stage,Log);
   cloud=new SetupCloud(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"RoboKorda","PrimeSecure Setup","classes"));
   Text="PrimeSecure | Student enrollment | "+Kit.VersionName;Font=new Font("Segoe UI",10);ForeColor=Color.FromArgb(30,41,59);BackColor=Color.FromArgb(245,247,252);MinimumSize=new Size(810,780);Size=new Size(920,950);StartPosition=FormStartPosition.CenterScreen;
   var scroll=new Panel{Dock=DockStyle.Fill,AutoScroll=true};var all=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=1,Padding=new Padding(20)};all.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));scroll.Controls.Add(all);Controls.Add(scroll);
   var brand=new Panel{Height=68,Dock=DockStyle.Top};try{brand.Controls.Add(new PictureBox{Image=Image.FromFile(Path.Combine(root,"brand","robokorda.jpg")),SizeMode=PictureBoxSizeMode.Zoom,Location=new Point(0,0),Size=new Size(52,52)});}catch(ArgumentException){}catch(IOException){}
   brand.Controls.Add(new Label{Text="PrimeSecure",Font=new Font(Font.FontFamily,23,FontStyle.Bold),ForeColor=purple,Location=new Point(65,0),AutoSize=true});brand.Controls.Add(new Label{Text="Connect. Choose a student. Enroll.",ForeColor=muted,Location=new Point(68,42),AutoSize=true});all.Controls.Add(brand);
   all.Controls.Add(new Label{Text="Unlock the Primebook, enable Wireless debugging and keep it on the same Wi-Fi as this PC.",AutoSize=true,MaximumSize=new Size(820,0),Margin=new Padding(0,0,0,10)});
   var links=Section("1  Connect a Primebook");AddField(links,"Pairing address (IP:port)",pairAddress,0);AddField(links,"Six-digit pairing code",pairCode,1);pairCode.UseSystemPasswordChar=true;pairCode.MaxLength=6;pair.Text="Pair";links.Controls.Add(pair,2,2);AddField(links,"Connection address (IP:port)",connection,2);connect.Text="Connect";links.Controls.Add(connect,2,4);all.Controls.Add(links);
   pairAddress.AccessibleName="Pairing address";connection.AccessibleName="Connection address";pairCode.AccessibleName="Pairing code";
   var student=Section("2  Student and school class");
   foreach(var combo in new[]{devices,schools,forms,classes}){combo.DropDownStyle=ComboBoxStyle.DropDownList;combo.Dock=DockStyle.Fill;}
   devices.AccessibleName="Connected Primebook";schools.AccessibleName="School";forms.AccessibleName="Form";classes.AccessibleName="Class";studentName.AccessibleName="Student real name";
   student.Controls.Add(devices,0,1);student.SetColumnSpan(devices,2);refresh.Text="Refresh devices";student.Controls.Add(refresh,2,1);
   student.Controls.Add(schools,0,2);student.SetColumnSpan(schools,2);signIn.Text="Admin sign in";student.Controls.Add(signIn,2,2);
   student.Controls.Add(new Label{Text="Student's real name",AutoSize=true},0,3);studentName.Dock=DockStyle.Fill;studentName.MaxLength=160;student.Controls.Add(studentName,1,3);student.SetColumnSpan(studentName,2);
   student.Controls.Add(new Label{Text="Form / class",AutoSize=true},0,4);student.Controls.Add(forms,1,4);student.Controls.Add(classes,2,4);
   classHint.Text="Sign in to load the school's forms and classes.";classHint.ForeColor=muted;classHint.AutoSize=true;classHint.MaximumSize=new Size(630,0);student.Controls.Add(classHint,0,5);student.SetColumnSpan(classHint,2);refreshClasses.Text="Refresh classes";student.Controls.Add(refreshClasses,2,5);all.Controls.Add(student);
   var enrollment=Section("3  Enter this key on the Primebook");key.ReadOnly=true;key.Font=new Font("Consolas",24,FontStyle.Bold);key.TextAlign=HorizontalAlignment.Center;key.Dock=DockStyle.Fill;key.AccessibleName="Generated enrollment key";key.TabStop=false;enrollment.Controls.Add(key,0,1);enrollment.SetColumnSpan(key,3);
   enrollment.Controls.Add(new Label{Text="Click Prepare and create key. Type the key on the Primebook, then click Enroll there. This PC waits for server confirmation.",AutoSize=true,MaximumSize=new Size(800,0),ForeColor=muted},0,2);enrollment.SetColumnSpan(enrollment.GetControlFromPosition(0,2),3);all.Controls.Add(enrollment);
   phase.Text="Checking setup kit...";phase.AutoSize=true;phase.Font=new Font(Font.FontFamily,11,FontStyle.Bold);all.Controls.Add(phase);progressBar.Maximum=6;progressBar.Dock=DockStyle.Top;progressBar.Height=12;all.Controls.Add(progressBar);result.AutoSize=true;result.MaximumSize=new Size(830,0);result.ForeColor=muted;result.Text="No device changes have been made.";result.Margin=new Padding(0,8,0,8);all.Controls.Add(result);
   var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true};prepare.Text="Prepare and create key";prepare.BackColor=purple;prepare.ForeColor=Color.White;cancel.Text="Stop waiting";next.Text="Next device";save.Text="Save log";foreach(var b in new[]{prepare,cancel,next,save}){b.AutoSize=true;b.Padding=new Padding(8,4,8,4);buttons.Controls.Add(b);}all.Controls.Add(buttons);
   messages.Multiline=true;messages.ReadOnly=true;messages.ScrollBars=ScrollBars.Vertical;messages.Dock=DockStyle.Top;messages.Height=115;messages.Font=new Font("Consolas",9);messages.AccessibleName="Setup activity log";all.Controls.Add(messages);
   foreach(var b in new[]{pair,connect,refresh,signIn,refreshClasses}){b.AutoSize=true;b.Dock=DockStyle.Fill;}
   devices.SelectedIndexChanged+=(s,e)=>{SetBusy(running!=null);if(running==null&&devices.SelectedItem!=null&&String.IsNullOrEmpty(pendingId)){phase.Text="Primebook selected - enter student details";studentName.Focus();}};
   schools.SelectedIndexChanged+=async(s,e)=>{if(!schoolLoading&&running==null)await Work(LoadClasses);};
   forms.SelectedIndexChanged+=(s,e)=>PopulateClasses();
   signIn.Click+=async(s,e)=>{using(var login=new StaffLogin()){if(login.ShowDialog(this)!=DialogResult.OK)return;string email=login.Email,password=login.Password;login.ClearPassword();await Work(async c=>{try{var list=await cloud.SignIn(email,password,c);schoolLoading=true;schools.Items.Clear();schools.Items.AddRange(list);if(list.Length>0)schools.SelectedIndex=0;schoolLoading=false;await LoadClasses(c);result.Text="Signed in. Select the connected Primebook and student details.";}finally{password=null;schoolLoading=false;}});}};
   refreshClasses.Click+=async(s,e)=>await Work(LoadClasses);
   pair.Click+=async(s,e)=>await Work(async c=>{string address=SetupEngine.Endpoint(pairAddress.Text),code=pairCode.Text;pairCode.Clear();devices.Items.Clear();Stage(0,"Pairing...");await engine.Pair(address,code,c);await Task.Delay(700,c);string found=await engine.DiscoverConnection(address,c);if(found!=null){connection.Text=found;await engine.Connect(found,c);await RefreshDevices(c,found);}else{await RefreshDevices(c,null);devices.SelectedIndex=-1;}result.Text=found==null?"Paired. Enter the separate connection address and click Connect.":"Connected. Enter the student's name and select their class.";});
   connect.Click+=async(s,e)=>await Work(async c=>{string address=SetupEngine.Endpoint(connection.Text);devices.Items.Clear();await engine.Connect(address,c);await RefreshDevices(c,address);phase.Text="Connected - student details ready";});
   refresh.Click+=async(s,e)=>await Work(c=>RefreshDevices(c,null));
   prepare.Click+=async(s,e)=>await Work(PrepareStudent);
   cancel.Click+=(s,e)=>{if(running!=null)running.Cancel();};
   next.Click+=(s,e)=>{if(pendingId!=null&&!completed&&MessageBox.Show(this,"This enrollment is not confirmed. Keep its student record for later and start the next device?","Pending enrollment",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes)return;pendingId=pendingSchool=boundDevice=hardware=null;completed=false;key.Clear();studentName.Clear();devices.SelectedIndex=-1;pairAddress.Clear();pairCode.Clear();connection.Clear();progressBar.Value=0;messages.Clear();sessionLog.Clear();phase.Text="Ready for the next Primebook";result.Text="Connect the next device. The school and class list are kept.";SetBusy(false);};
   save.Click+=(s,e)=>{using(var dialog=new SaveFileDialog{Filter="Text log|*.txt",FileName="PrimeSecure-setup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".txt"})if(dialog.ShowDialog(this)==DialogResult.OK)File.WriteAllLines(dialog.FileName,sessionLog);};
   FormClosing+=(s,e)=>{if(running!=null)running.Cancel();};FormClosed+=(s,e)=>cloud.Dispose();
   Shown+=async(s,e)=>{if(preview){kitValid=false;phase.Text="Preview - PrimeSecure "+Kit.VersionName;SetBusy(false);return;}await Work(async c=>{VerifyKit();phase.Text="Ready - PrimeSecure "+Kit.VersionName+" ("+Kit.VersionCode+")";await RefreshDevices(c,null);});};
  }
  async Task LoadClasses(CancellationToken c){var school=schools.SelectedItem as School;if(school==null)return;classList=await cloud.Classes(school.id,c);forms.Items.Clear();forms.Items.AddRange(classList.Select(k=>k.form_level).Distinct().OrderBy(x=>x).Cast<object>().ToArray());if(forms.Items.Count>0)forms.SelectedIndex=0;else classes.Items.Clear();classHint.Text=cloud.CachedClasses?"Saved class list ("+cloud.CacheDate+"). Reconnect to create a key.":"Classes synced from the admin dashboard. Refreshed when you create a key.";}
  void PopulateClasses(){classes.Items.Clear();string level=forms.SelectedItem as string;foreach(var k in classList.Where(k=>k.form_level==level&&!String.IsNullOrWhiteSpace(k.class_name)))classes.Items.Add(k);if(classes.Items.Count>0)classes.SelectedIndex=0;}
  async Task PrepareStudent(CancellationToken c){
   if(completed){result.Text="Enrollment already confirmed. Click Next device.";return;}
   var device=devices.SelectedItem as Device;var school=schools.SelectedItem as School;var klass=classes.SelectedItem as SchoolClass;
   if(device==null||device.State!="device")throw new InvalidOperationException("Select a connected and authorized Primebook first.");
   if(school==null)throw new InvalidOperationException("Sign in and select the school first.");
   if(pendingId==null){if(studentName.Text.Trim().Length<2||klass==null)throw new InvalidOperationException("Enter the student's name and select a form and class.");VerifyKit();var outcome=await engine.Prepare(device.Serial,"",Path.Combine(root,Kit.ApkFile),Kit.ApkSha256,c,true);if(outcome.AlreadyEnrolled){phase.Text="Existing enrollment retained";result.Text=outcome.Message;completed=true;return;}hardware=outcome.HardwareSerial;boundDevice=device.Serial;pendingSchool=school.id;pendingId=Guid.NewGuid().ToString();}
   if(device.Serial!=boundDevice||school.id!=pendingSchool)throw new InvalidOperationException("Resume with the same device and school, or click Next device.");
   Stage(5,"Creating or resuming the student enrollment key");
   var student=await cloud.Create(pendingSchool,pendingId,studentName.Text,klass,c);
   if(!SetupCloud.Confirmed(student,hardware)){key.Text=SetupEngine.EnrollmentKey(student.enroll_token??"");key.Focus();key.SelectAll();result.Text="Type "+key.Text+" on the Primebook and click Enroll. Keep both devices online.";phase.Text="Waiting for server confirmation";}
   while(!SetupCloud.Confirmed(student,hardware)){
    await Task.Delay(3000,c);
    try{student=await cloud.Find(pendingSchool,pendingId,c);if(student==null)throw new InvalidOperationException("The student record was removed. Check the dashboard before continuing.");phase.Text="Waiting for the student to enroll on the Primebook";}
    catch(HttpRequestException){phase.Text="Connection interrupted - retrying in 3 seconds";}
    catch(TaskCanceledException){c.ThrowIfCancellationRequested();phase.Text="Server took too long - retrying";}
   }
   completed=true;key.Clear();Stage(6,"All good - enrollment confirmed by the server");result.ForeColor=Color.FromArgb(15,118,80);result.Text=student.student_name+" is enrolled on this Primebook"+(String.IsNullOrEmpty(student.student_id)?"":" ("+student.student_id+")")+". Keep it online for school preparation. Click Next device when ready.";
  }
  TableLayoutPanel Section(string title){var p=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=3,BackColor=Color.White,Padding=new Padding(12),Margin=new Padding(0,0,0,10)};p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,40));p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,35));p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,25));var label=new Label{Text=title,AutoSize=true,ForeColor=purple,Font=new Font(Font.FontFamily,11,FontStyle.Bold),Margin=new Padding(0,0,0,8)};p.Controls.Add(label,0,0);p.SetColumnSpan(label,3);return p;}
  void AddField(TableLayoutPanel panel,string label,TextBox input,int index){int col=index==1?1:0,row=index<2?0:2;panel.Controls.Add(new Label{Text=label,AutoSize=true,ForeColor=muted},col,row+1);input.Dock=DockStyle.Fill;panel.Controls.Add(input,col,row+2);if(index==2)panel.SetColumnSpan(input,2);}
  async Task Work(Func<CancellationToken,Task> work){if(running!=null)return;running=new CancellationTokenSource();SetBusy(true);result.ForeColor=muted;try{await work(running.Token);}catch(OperationCanceledException){phase.Text="Stopped waiting";result.Text="The pending student and key are kept in this window. Click Prepare to resume; check the dashboard before starting another.";}catch(HttpRequestException){phase.Text="No server connection";result.Text="Check internet and retry. The pending student is kept to prevent duplicate records.";}catch(Exception error){phase.Text="Needs attention";result.ForeColor=Color.FromArgb(180,35,53);result.Text=error.Message;Log(error.Message);}finally{running.Dispose();running=null;if(!IsDisposed)SetBusy(false);}}
  void SetBusy(bool busy){bool ready=kitValid&&!preview;foreach(var control in new Control[]{pair,connect,refresh,next,pairAddress,pairCode,connection,devices})control.Enabled=ready&&!busy;bool editable=ready&&!busy&&pendingId==null;signIn.Enabled=ready&&!busy;schools.Enabled=editable;refreshClasses.Enabled=editable;bool connected=devices.SelectedItem is Device&&((Device)devices.SelectedItem).State=="device";studentName.Enabled=editable&&connected;forms.Enabled=editable&&connected;classes.Enabled=editable&&connected;prepare.Enabled=ready&&!busy&&connected&&!completed;cancel.Enabled=busy;UseWaitCursor=false;}
  async Task RefreshDevices(CancellationToken c,string preferred){string previous=devices.SelectedItem is Device?((Device)devices.SelectedItem).Serial:null;var found=await engine.Refresh(c);devices.Items.Clear();foreach(var d in found)devices.Items.Add(d);var selected=found.FirstOrDefault(d=>d.Serial==(preferred??previous));if(selected!=null)devices.SelectedItem=selected;else if(preferred==null&&found.Count==1)devices.SelectedIndex=0;if(found.Count==0)result.Text="No Primebook connected. Pair/connect over Wi-Fi or authorize a supported USB debugging connection.";}
  void Stage(int value,string title){progressBar.Value=Math.Min(6,value);phase.Text=title;Log(title);}
  void Log(string message){string line=DateTime.Now.ToString("HH:mm:ss")+"  "+message;sessionLog.Add(line);if(!messages.IsDisposed)messages.AppendText(line+Environment.NewLine);}
  void VerifyKit(){kitValid=false;foreach(var entry in Kit.Files){string path=Path.GetFullPath(Path.Combine(root,entry.Key));if(!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!File.Exists(path)||SetupEngine.Hash(path)!=entry.Value)throw new InvalidOperationException("Setup kit missing or modified: "+entry.Key+". Extract the complete ZIP again.");}kitValid=true;}
 }
 sealed class StaffLogin:Form{
  readonly TextBox email=new TextBox(),password=new TextBox();public string Email{get{return email.Text;}}public string Password{get{return password.Text;}}public void ClearPassword(){password.Clear();}
  public StaffLogin(){Text="School administrator sign in";Size=new Size(440,245);StartPosition=FormStartPosition.CenterParent;Font=new Font("Segoe UI",10);var panel=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(18),ColumnCount=1};panel.Controls.Add(new Label{Text="Use your PrimeSecure dashboard account.",AutoSize=true});email.AccessibleName="Admin email";password.AccessibleName="Admin password";email.Dock=password.Dock=DockStyle.Top;password.UseSystemPasswordChar=true;panel.Controls.Add(new Label{Text="Email",AutoSize=true});panel.Controls.Add(email);panel.Controls.Add(new Label{Text="Password",AutoSize=true});panel.Controls.Add(password);var button=new Button{Text="Sign in",AutoSize=true,DialogResult=DialogResult.OK};panel.Controls.Add(button);AcceptButton=button;Controls.Add(panel);}
 }
 static class Program{
  [STAThread]static void Main(string[] args){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);var form=new SetupForm(AppDomain.CurrentDomain.BaseDirectory,args.Contains("--preview")||args.Contains("--capture"));int capture=Array.IndexOf(args,"--capture");if(capture<0)capture=Array.IndexOf(args,"--capture-live");if(capture>=0&&capture+1<args.Length)form.Shown+=(s,e)=>{int ticks=0;var timer=new System.Windows.Forms.Timer{Interval=500};timer.Tick+=(sender,eventArgs)=>{if(form.IsWorking&&++ticks<60)return;timer.Stop();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));bitmap.Save(args[capture+1]);}File.WriteAllText(args[capture+1]+".txt",form.DiagnosticState);form.Close();};timer.Start();};Application.Run(form);}
 }
}
