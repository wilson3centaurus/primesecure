using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PrimeSecureSetup {
    public sealed class SetupForm : Form {
        readonly Color purple=Color.FromArgb(87,64,196),ink=Color.FromArgb(30,41,59),muted=Color.FromArgb(100,116,139);
        readonly TextBox connection=new TextBox(),pairAddress=new TextBox(),pairCode=new TextBox(),key=new TextBox(),messages=new TextBox();
        readonly ComboBox devices=new ComboBox();readonly Label result=new Label(),phase=new Label();readonly ProgressBar progressBar=new ProgressBar();
        readonly Button pair=new Button(),connect=new Button(),refresh=new Button(),prepare=new Button(),cancel=new Button(),next=new Button(),save=new Button();
        readonly string root;readonly SetupEngine engine;readonly bool preview;CancellationTokenSource running;bool formatting,kitValid;
        readonly List<string> sessionLog=new List<string>();
        public bool IsWorking { get { return running!=null; } }
        public string DiagnosticState { get { return "Kit verified: "+kitValid+"\r\nPrepare enabled: "+prepare.Enabled+"\r\nBusy: "+IsWorking+"\r\nStatus: "+result.Text; } }
        public SetupForm(string root,bool preview) {
            this.root=root;this.preview=preview;
            engine=new SetupEngine(new AdbProcess(Path.Combine(root,"tools","adb.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"RoboKorda","PrimeSecure Setup","android")),Stage,Log);
            Text="PrimeSecure | School setup";Font=new Font("Segoe UI",10);ForeColor=ink;BackColor=Color.FromArgb(245,247,252);MinimumSize=new Size(780,760);Size=new Size(870,890);StartPosition=FormStartPosition.CenterScreen;
            var all=new TableLayoutPanel { Dock=DockStyle.Fill,ColumnCount=1,RowCount=7,Padding=new Padding(22),AutoScroll=true };
            all.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            all.RowStyles.Add(new RowStyle(SizeType.Absolute,78));all.RowStyles.Add(new RowStyle(SizeType.Absolute,66));all.RowStyles.Add(new RowStyle(SizeType.Absolute,190));all.RowStyles.Add(new RowStyle(SizeType.Absolute,126));all.RowStyles.Add(new RowStyle(SizeType.Absolute,96));all.RowStyles.Add(new RowStyle(SizeType.Percent,100));all.RowStyles.Add(new RowStyle(SizeType.Absolute,54));
            var brand=new Panel { Dock=DockStyle.Fill };
            string logo=Path.Combine(root,"brand","robokorda.jpg");
            try { if(File.Exists(logo))brand.Controls.Add(new PictureBox { Image=Image.FromFile(logo),SizeMode=PictureBoxSizeMode.Zoom,Location=new Point(0,6),Size=new Size(55,55) }); }
            catch(ArgumentException) {} catch(OutOfMemoryException) {}
            brand.Controls.Add(new Label { Text="PrimeSecure",Font=new Font(Font.FontFamily,23,FontStyle.Bold),ForeColor=purple,Location=new Point(70,0),AutoSize=true });
            brand.Controls.Add(new Label { Text="School device setup  |  RoboKorda",ForeColor=muted,Location=new Point(73,45),AutoSize=true });all.Controls.Add(brand);
            all.Controls.Add(new Label { Text="Unlock the Primebook and enable Wireless debugging. Keep both devices on the same Wi-Fi.\r\nEnter pairing details once; then connect, choose the device and prepare it. USB works only if the Primebook supports a debugging connection.",Dock=DockStyle.Fill,ForeColor=muted,Padding=new Padding(0,4,0,0) });
            var links=Section("1  Connect a Primebook",3);
            AddField(links,"Pairing address (IP:port)",pairAddress,0);AddField(links,"Six-digit pairing code",pairCode,1);pairCode.UseSystemPasswordChar=true;pairCode.MaxLength=6;
            pair.Text="Pair";links.Controls.Add(pair,2,2);
            AddField(links,"Connection address (IP:port)",connection,2);connect.Text="Connect";links.Controls.Add(connect,2,4);
            pairAddress.AccessibleName="Pairing address";connection.AccessibleName="Connection address";pairCode.AccessibleName="Pairing code";
            var hint=new Label { Text="Pairing and connection ports are different. If automatic discovery fails, use the address on Wireless debugging's main screen.",Dock=DockStyle.Fill,ForeColor=muted,Font=new Font(Font.FontFamily,9),Padding=new Padding(0,5,0,0) };links.Controls.Add(hint,0,5);links.SetColumnSpan(hint,3);all.Controls.Add(links);
            var student=Section("2  Select device and enrollment key",3);devices.DropDownStyle=ComboBoxStyle.DropDownList;devices.Dock=DockStyle.Fill;devices.AccessibleName="Connected Primebook";student.Controls.Add(devices,0,1);student.SetColumnSpan(devices,2);refresh.Text="Refresh";student.Controls.Add(refresh,2,1);
            student.Controls.Add(new Label { Text="School enrollment key",AutoSize=true,Dock=DockStyle.Fill },0,2);key.Dock=DockStyle.Fill;key.Font=new Font("Consolas",14,FontStyle.Bold);key.CharacterCasing=CharacterCasing.Upper;key.AccessibleName="School enrollment key";student.Controls.Add(key,1,2);student.SetColumnSpan(key,2);all.Controls.Add(student);
            var activity=new TableLayoutPanel { Dock=DockStyle.Fill,ColumnCount=1,RowCount=3 };
            phase.Text="Checking setup kit...";phase.AutoSize=true;phase.Dock=DockStyle.Fill;phase.Font=new Font(Font.FontFamily,10,FontStyle.Bold);activity.Controls.Add(phase);
            progressBar.Dock=DockStyle.Fill;progressBar.Maximum=6;activity.Controls.Add(progressBar);result.Text="No device changes have been made.";result.Dock=DockStyle.Fill;result.ForeColor=muted;result.AutoEllipsis=true;activity.Controls.Add(result);all.Controls.Add(activity);
            messages.Multiline=true;messages.ReadOnly=true;messages.ScrollBars=ScrollBars.Vertical;messages.Dock=DockStyle.Fill;messages.BackColor=Color.White;messages.BorderStyle=BorderStyle.FixedSingle;messages.Font=new Font("Consolas",9);messages.AccessibleName="Setup activity log";all.Controls.Add(messages);
            var buttons=new FlowLayoutPanel { Dock=DockStyle.Fill,FlowDirection=FlowDirection.LeftToRight,Padding=new Padding(0,8,0,0) };
            prepare.Text="Prepare Primebook";prepare.BackColor=purple;prepare.ForeColor=Color.White;prepare.FlatStyle=FlatStyle.Flat;prepare.AutoSize=true;
            cancel.Text="Stop waiting";cancel.Enabled=false;next.Text="Next device";save.Text="Save log";foreach(var b in new[]{prepare,cancel,next,save}) { b.AutoSize=true;b.Padding=new Padding(9,4,9,4);buttons.Controls.Add(b); }all.Controls.Add(buttons);Controls.Add(all);
            foreach(var b in new[]{pair,connect,refresh}) { b.Dock=DockStyle.Fill;b.AutoSize=true; }
            key.TextChanged+=(s,e)=>{
                if(formatting)return;formatting=true;int pos=key.SelectionStart;string compact=key.Text.Replace("-","");string value=compact.Length>4?compact.Substring(0,4)+"-"+compact.Substring(4):compact;
                if(value!=key.Text) { key.Text=value;key.SelectionStart=Math.Min(value.Length,pos+(value.Length>pos&&pos==4?1:0)); }formatting=false;
            };
            pair.Click+=async(s,e)=>await Work(async c=>{
                string address=SetupEngine.Endpoint(pairAddress.Text),code=pairCode.Text;pairCode.Clear();devices.Items.Clear();Stage(0,"Pairing with the Primebook...");await engine.Pair(address,code,c);await Task.Delay(700,c);
                string found=await engine.DiscoverConnection(address,c);if(found!=null) { connection.Text=found;await engine.Connect(found,c);await RefreshDevices(c,found);result.Text="Paired and connected. Select the correct device and enter its enrollment key."; }
                else { await RefreshDevices(c,null);devices.SelectedIndex=-1;result.Text="Paired. Enter the connection address from Wireless debugging's main screen, then Connect."; }
                phase.Text="Pairing accepted";
            });
            connect.Click+=async(s,e)=>await Work(async c=>{string address=SetupEngine.Endpoint(connection.Text);devices.Items.Clear();await engine.Connect(address,c);await RefreshDevices(c,address);phase.Text="Connected";result.Text="Confirm the selected device, enter its school key and click Prepare Primebook.";});
            refresh.Click+=async(s,e)=>await Work(c=>RefreshDevices(c,null));
            prepare.Click+=async(s,e)=>await Work(async c=>{
                var selected=devices.SelectedItem as Device;if(selected==null)throw new InvalidOperationException("Select a connected Primebook first.");
                string token=SetupEngine.EnrollmentKey(key.Text);key.Clear();
                VerifyKit();Log("Preparing selected device: "+selected.Serial);
                var outcome=await engine.Prepare(selected.Serial,token,Path.Combine(root,Kit.ApkFile),Kit.ApkSha256,c);
                result.ForeColor=outcome.AlreadyEnrolled?Color.DarkGoldenrod:Color.FromArgb(15,118,80);result.Text=outcome.Message;
                phase.Text=outcome.AlreadyEnrolled?"Existing enrollment retained":"Enrollment confirmed";Log(outcome.Message);
            });
            cancel.Click+=(s,e)=>{if(running!=null)running.Cancel();};next.Click+=(s,e)=>{connection.Clear();pairAddress.Clear();pairCode.Clear();key.Clear();devices.Items.Clear();progressBar.Value=0;phase.Text="Ready for the next Primebook";result.Text="Connect and select the next device. Its enrollment key is separate.";messages.Clear();sessionLog.Clear();};
            save.Click+=(s,e)=>{using(var dialog=new SaveFileDialog { Filter="Text log|*.txt",FileName="PrimeSecure-setup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".txt" }) { if(dialog.ShowDialog(this)==DialogResult.OK)File.WriteAllLines(dialog.FileName,sessionLog); }};
            FormClosing+=(s,e)=>{if(running!=null)running.Cancel();};
            Shown+=async(s,e)=>{
                if(preview) { phase.Text="Ready - PrimeSecure "+Kit.VersionName;result.Text="Preview only. No device actions are enabled.";foreach(var b in new[]{pair,connect,refresh,prepare})b.Enabled=false;return; }
                await Work(async c=>{VerifyKit();phase.Text="Ready - PrimeSecure "+Kit.VersionName+" ("+Kit.VersionCode+")";await RefreshDevices(c,null);Log("Setup kit verified. Pair/connect a Primebook to begin.");});
            };
        }
        TableLayoutPanel Section(string title,int columns) {
            var panel=new TableLayoutPanel { Dock=DockStyle.Fill,ColumnCount=columns,RowCount=6,BackColor=Color.White,Padding=new Padding(12),Margin=new Padding(0,0,0,10) };
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,42));panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,40));panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,18));
            var label=new Label { Text=title,Font=new Font(Font.FontFamily,11,FontStyle.Bold),AutoSize=true,ForeColor=purple,Dock=DockStyle.Fill,Margin=new Padding(0,0,0,9) };panel.Controls.Add(label,0,0);panel.SetColumnSpan(label,columns);return panel;
        }
        void AddField(TableLayoutPanel panel,string label,TextBox input,int index) {
            int col=index==1?1:0,row=index<2?0:2;
            panel.Controls.Add(new Label { Text=label,AutoSize=true,ForeColor=muted,Dock=DockStyle.Fill },col,row+1);input.Dock=DockStyle.Fill;panel.Controls.Add(input,col,row+2);
            if(index==2)panel.SetColumnSpan(input,2);
        }
        async Task Work(Func<CancellationToken,Task> work) {
            if(running!=null)return;running=new CancellationTokenSource();SetBusy(true);result.ForeColor=muted;
            try { await work(running.Token); }
            catch(OperationCanceledException) { phase.Text="Stopped waiting";result.Text="The device may finish its current operation. Refresh and check it before retrying. No rollback or reset was performed.";Log(result.Text); }
            catch(Exception error) { phase.Text="Needs attention";result.ForeColor=Color.FromArgb(180,35,53);result.Text=error.Message;Log(error.Message); }
            finally { running.Dispose();running=null;if(!IsDisposed)SetBusy(false); }
        }
        void SetBusy(bool busy) { foreach(var control in new Control[]{pair,connect,refresh,prepare,next,connection,pairAddress,pairCode,key,devices})control.Enabled=!busy&&kitValid;cancel.Enabled=busy;UseWaitCursor=busy; }
        async Task RefreshDevices(CancellationToken c,string preferred) {
            string previous=(devices.SelectedItem as Device)==null?null:((Device)devices.SelectedItem).Serial;var found=await engine.Refresh(c);devices.Items.Clear();foreach(var d in found)devices.Items.Add(d);
            var selected=found.FirstOrDefault(d=>d.Serial==(preferred??previous));if(selected!=null)devices.SelectedItem=selected;else if(preferred==null&&found.Count==1)devices.SelectedIndex=0;
            if(found.Count==0)result.Text="No devices connected yet. Pair/connect over Wi-Fi, or authorize a supported USB debugging connection.";
        }
        void Stage(int value,string title) { progressBar.Value=Math.Min(6,value);phase.Text=title;Log(title); }
        void Log(string message) { string line=DateTime.Now.ToString("HH:mm:ss")+"  "+message;sessionLog.Add(line);if(!messages.IsDisposed)messages.AppendText(line+Environment.NewLine); }
        void VerifyKit() {
            kitValid=false;
            foreach(var entry in Kit.Files) {
                string path=Path.GetFullPath(Path.Combine(root,entry.Key));if(!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!File.Exists(path)||SetupEngine.Hash(path)!=entry.Value)
                    throw new InvalidOperationException("The setup kit is missing a file or its checksum differs: "+entry.Key+". Extract the complete ZIP again.");
            }
            kitValid=true;
        }
    }
    static class Program {
        [STAThread] static void Main(string[] args) {
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            var form=new SetupForm(AppDomain.CurrentDomain.BaseDirectory,args.Contains("--preview")||args.Contains("--capture"));
            int capture=Array.IndexOf(args,"--capture");if(capture<0)capture=Array.IndexOf(args,"--capture-live");
            if(capture>=0&&capture+1<args.Length)form.Shown+=(s,e)=>{int ticks=0;var timer=new System.Windows.Forms.Timer { Interval=500 };timer.Tick+=(sender,eventArgs)=>{if(form.IsWorking&&++ticks<60)return;timer.Stop();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));bitmap.Save(args[capture+1]);}File.WriteAllText(args[capture+1]+".txt",form.DiagnosticState);form.Close();};timer.Start();};
            Application.Run(form);
        }
    }
}
