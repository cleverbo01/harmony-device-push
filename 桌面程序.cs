using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class ReminderWindow : Form {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string data;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly Label status = new Label(), processStatus = new Label(), historyTitle = new Label();
    readonly CheckBox[] pushChecks=new CheckBox[3];
    readonly Dictionary<string,bool> sourcePush=new Dictionary<string,bool>{{"Codex",true},{"DSH",true},{"DIY",true}};
    readonly HashSet<string> mutedTasks=new HashSet<string>();
    bool updatingPush;
    readonly Button settingsToggle=new Button(), saveSettings=new Button();
    readonly Panel settingsPanel=new Panel();
    readonly TextBox deviceId=new TextBox();
    readonly Label settingsFeedback=new Label();
    readonly Button start = new Button(), stop = new Button(), test = new Button(), newest = new Button();
    readonly TableLayoutPanel sessions = new TableLayoutPanel();
    readonly ComboBox[] selectors = new ComboBox[3];
    readonly Button[] titleButtons=new Button[3], historyButtons=new Button[3];
    readonly ContextMenuStrip[] titleMenus=new ContextMenuStrip[3], historyMenus=new ContextMenuStrip[3];
    readonly List<string>[] messageHistory=new List<string>[3];
    readonly int[] historyIndex=new int[3];
    readonly string[] displayedTaskIds=new string[3];
    readonly Panel[] cards = new Panel[3];
    readonly Label[] names = new Label[3], modes = new Label[3], badges = new Label[3], directories = new Label[3];
    readonly Label[] monitorBadges=new Label[3];
    readonly FlowLayoutPanel[] details = new FlowLayoutPanel[3];
    readonly Panel[] stripes = new Panel[3];
    List<Dictionary<string,object>> conversations = new List<Dictionary<string,object>>();
    string[] selectedIds = new string[3];
    bool[] blankSlots=new bool[3];
    string workerError="";
    bool updatingSelectors;
    bool monitoring;
    string cardsSignature="";
    DateTime statusStamp=DateTime.MinValue, logStamp=DateTime.MinValue;
    bool? previousRunning;
    sealed class Choice {public string Id;public string Title; public override string ToString(){return Title;}}
    readonly RichTextBox logs = new RichTextBox();
    string lastLogText="";
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    string nodePath;
    bool refreshing, closing, ownsWorker, selfTesting;
    Process worker;


    public ReminderWindow() {
        data = Path.Combine(root, "运行记录"); Directory.CreateDirectory(data);
        string configFile=Path.Combine(root,"config.json");
        if(!File.Exists(configFile)){var initial=new Dictionary<string,object>{{"pushBaseUrl",""},{"pollSeconds",8},{"dshEnabled",true},{"localApi",new Dictionary<string,object>{{"enabled",true},{"port",17863},{"token",Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N")}}}};File.WriteAllText(configFile,json.Serialize(initial),new System.Text.UTF8Encoding(false));}
        var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configFile));
        nodePath=FindNode(config);LoadPolicy(config);
        Text="鸿蒙设备信息推送工具"; Size=new Size(1280,940); MinimumSize=new Size(1080,860);
        StartPosition=FormStartPosition.CenterScreen; Font=new Font("Microsoft YaHei UI",10.5f);ForeColor=Color.FromArgb(35,45,60);
        BackColor=Color.FromArgb(245,247,250); AutoScaleMode=AutoScaleMode.Dpi;
        var heading=new Label { Text="鸿蒙设备信息推送工具", Font=new Font(Font.FontFamily,20,FontStyle.Bold), Location=new Point(24,20), Size=new Size(640,48) };
        Controls.Add(heading);
        status.SetBounds(24,76,670,44); status.Text="尚未监听。点击“刷新并开始监控”发现对话并启用推送。"; status.Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right; Controls.Add(status);
        SetupButton(start,"刷新并开始监控",24); SetupButton(stop,"停止监听",220); SetupButton(test,"测试推送",416);
        start.Click+=async(s,e)=>await StartMonitor();
        stop.Click+=(s,e)=>RequestStop();
        test.Click+=async(s,e)=>await TestPush();
        var integrations=new Button();SetupButton(integrations,"接入接口说明",612);integrations.Click+=(s,e)=>{try{Process.Start(new ProcessStartInfo(Path.Combine(root,"接入接口说明.md")){UseShellExecute=true});}catch(Exception ex){MessageBox.Show(ex.Message,"接口说明");}};
        var note=new Label { Text="Codex · DeepSeek Harness · 自定义来源，三个窗口可分别选择任务。", Location=new Point(24,194), Size=new Size(970,40), Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right };
        Controls.Add(note);
        sessions.SetBounds(24,236,1176,300); sessions.Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right;
        sessions.ColumnCount=3; sessions.RowCount=1; sessions.BackColor=BackColor;
        for(int i=0;i<3;i++)sessions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.333f));
        sessions.RowStyles.Add(new RowStyle(SizeType.Percent,100)); Controls.Add(sessions); InitializeCards();
        processStatus.SetBounds(24,546,1176,32); processStatus.Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right; Controls.Add(processStatus);
        historyTitle.Text="运行与推送日志 · 最新在上";historyTitle.SetBounds(24,580,800,26);Controls.Add(historyTitle);
        newest.Text="回到最新";newest.SetBounds(1060,578,140,28);newest.Anchor=AnchorStyles.Top|AnchorStyles.Right;newest.Click+=(s,e)=>{logs.Select(0,0);logs.ScrollToCaret();};Controls.Add(newest);
        logs.SetBounds(24,614,1176,190); logs.Anchor=AnchorStyles.Top|AnchorStyles.Bottom|AnchorStyles.Left|AnchorStyles.Right;
        logs.ReadOnly=true;logs.WordWrap=true;logs.ScrollBars=RichTextBoxScrollBars.Vertical;logs.BackColor=Color.White;logs.BorderStyle=BorderStyle.FixedSingle;logs.DetectUrls=false;logs.Font=new Font("Microsoft YaHei UI",10);Controls.Add(logs);
        foreach(var panel in details)panel.Resize+=(s,e)=>ResizeBubbles((FlowLayoutPanel)s);
        UpdateLogs(new[]{"暂无日志。点击“刷新并开始监控”后开始监听。"});
        InitializeSettings(config);
        Resize+=(s,e)=>ArrangeWindow();ArrangeWindow();
        timer.Interval=3000; timer.Tick+=async(s,e)=>await RefreshStatus();
        Shown+=async(s,e)=>{if(selfTesting)return;timer.Start();await RefreshStatus();};
        FormClosing+=OnClosing;
    }
    void ArrangeWindow(){
        int width=ClientSize.Width-48;
        int cardHeight=Math.Max(370,(int)((ClientSize.Height-280)*0.64));
        sessions.SetBounds(24,242,width,cardHeight);
        processStatus.SetBounds(24,118,Math.Max(640,width-400),24);processStatus.Font=new Font(Font.FontFamily,9.5f);processStatus.ForeColor=Color.FromArgb(90,105,125);
        historyTitle.SetBounds(24,sessions.Bottom+18,Math.Max(500,width-160),26);
        newest.SetBounds(ClientSize.Width-164,historyTitle.Top,140,28);
        logs.SetBounds(24,historyTitle.Bottom+10,width,Math.Max(110,ClientSize.Height-historyTitle.Bottom-30));
        settingsToggle.SetBounds(ClientSize.Width-194,24,170,34);
        settingsPanel.SetBounds(ClientSize.Width-424,66,400,230);
        settingsPanel.BringToFront();settingsToggle.BringToFront();
    }
    static string BuildPushAddress(string id){
        id=(id??"").Trim();
        if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"\A[a-zA-Z0-9]{1,64}\z"))throw new Exception("设备 ID 只能包含英文字母和数字（1–64 位）。");
        return "https://api.chuckfang.com/"+id+"/";
    }
    void InitializeSettings(Dictionary<string,object> config){
        settingsToggle.Text="推送设置 ▸";settingsToggle.FlatStyle=FlatStyle.Flat;settingsToggle.BackColor=Color.White;Controls.Add(settingsToggle);
        settingsPanel.BackColor=Color.White;settingsPanel.BorderStyle=BorderStyle.FixedSingle;settingsPanel.Visible=false;Controls.Add(settingsPanel);
        settingsPanel.Controls.Add(new Label{Text="MeoW 设备 ID",Location=new Point(14,12),Size=new Size(120,24)});
        deviceId.SetBounds(14,40,220,28);Uri pushUri;deviceId.Text=Uri.TryCreate(Str(config,"pushBaseUrl"),UriKind.Absolute,out pushUri)?pushUri.AbsolutePath.Trim('/'):"";settingsPanel.Controls.Add(deviceId);
        saveSettings.Text="保存并收起";saveSettings.SetBounds(244,39,110,30);settingsPanel.Controls.Add(saveSettings);
        settingsFeedback.SetBounds(14,78,340,48);settingsFeedback.Text="地址：https://api.chuckfang.com/设备ID/";settingsFeedback.ForeColor=Color.DimGray;settingsPanel.Controls.Add(settingsFeedback);
        int sx=14;foreach(string source in new[]{"Codex","DSH","DIY"}){string key=source;var check=new CheckBox{Text=source,Checked=sourcePush[source],Location=new Point(sx,142),Size=new Size(110,28)};check.CheckedChanged+=(s,e)=>{sourcePush[key]=check.Checked;SavePolicy();};settingsPanel.Controls.Add(check);sx+=120;}
        settingsPanel.Controls.Add(new Label{Text="勾选来源才推送；每个任务可单独静音。",Location=new Point(14,182),Size=new Size(370,28)});
        if(deviceId.Text.Length==0){settingsPanel.Visible=true;settingsToggle.Text="推送设置 ▾";status.Text="首次使用：填写 MeoW 设备 ID，保存后开始监控。";}
        settingsToggle.Click+=(s,e)=>{settingsPanel.Visible=!settingsPanel.Visible;settingsToggle.Text=settingsPanel.Visible?"推送设置 ▾":"推送设置 ▸";};
        saveSettings.Click+=(s,e)=>{
            try{
                string address=BuildPushAddress(deviceId.Text);
                string file=Path.Combine(root,"config.json");var current=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
                if(Convert.ToString(current["pushBaseUrl"])!=address){
                    string folder=Path.Combine(root,"备份","推送地址修改");Directory.CreateDirectory(folder);
                    File.Copy(file,Path.Combine(folder,"config-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")+".json"));
                    current["pushBaseUrl"]=address;string temp=file+".tmp";File.WriteAllText(temp,json.Serialize(current),new System.Text.UTF8Encoding(false));File.Replace(temp,file,null);
                }
                File.WriteAllText(Path.Combine(data,"refresh.request"),"refresh");
                settingsPanel.Visible=false;settingsToggle.Text="推送设置 ▸";
                status.Text="推送设置已保存；运行中的监听将在下一检测周期使用新地址。";
            }catch(Exception ex){settingsFeedback.Text=ex.Message;settingsFeedback.ForeColor=Color.Firebrick;}
        };
    }
    void InitializeCards() {
        for(int i=0;i<3;i++) {
            int slot=i;
            var card=new Panel {Dock=DockStyle.Fill,BackColor=Color.White,Margin=new Padding(i==0?0:6,0,i==2?0:6,0),BorderStyle=BorderStyle.FixedSingle};cards[i]=card;
            var layout=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=7,Padding=new Padding(14)};
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            foreach(float height in new float[]{54,26,28,34})layout.RowStyles.Add(new RowStyle(SizeType.Absolute,height));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,30));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,46));
            selectors[i]=new ComboBox {Dock=DockStyle.Fill,DropDownStyle=ComboBoxStyle.DropDownList,Font=new Font(Font.FontFamily,9)};
            selectors[i].SelectedIndexChanged+=(s,e)=>{if(updatingSelectors)return;var choice=selectors[slot].SelectedItem as Choice;selectedIds[slot]=choice==null?null:choice.Id;RenderSlot(slot);};
            names[i]=new Label {Dock=DockStyle.Fill,Text="暂无对话",Font=new Font(Font.FontFamily,12,FontStyle.Bold),AutoEllipsis=true};
            badges[i]=new Label {Dock=DockStyle.Fill,Text="● 等待发现",ForeColor=Color.Gray};
            monitorBadges[i]=new Label{Dock=DockStyle.Bottom,Height=22,ForeColor=Color.Gray,Font=new Font(Font.FontFamily,9)};
            var statePanel=new Panel{Dock=DockStyle.Fill};badges[i].Dock=DockStyle.Top;badges[i].Height=24;statePanel.Controls.Add(badges[i]);
            modes[i]=new Label {Dock=DockStyle.Fill,ForeColor=Color.DimGray,AutoEllipsis=true};
            details[i]=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=false,BackColor=Color.FromArgb(242,246,251),FlowDirection=FlowDirection.TopDown,WrapContents=false};
            directories[i]=new Label {Dock=DockStyle.Fill,ForeColor=Color.Gray,AutoEllipsis=true};
            titleButtons[i]=new Button {Dock=DockStyle.Fill,Text="选择对话  ▾",TextAlign=ContentAlignment.MiddleLeft,FlatStyle=FlatStyle.Flat,BackColor=Color.White,Font=new Font(Font.FontFamily,11.5f,FontStyle.Bold)};
            titleMenus[i]=new ContextMenuStrip {Font=new Font(Font.FontFamily,10)};historyMenus[i]=new ContextMenuStrip {Font=new Font(Font.FontFamily,10)};
            titleButtons[i].FlatAppearance.BorderSize=0;titleButtons[i].FlatAppearance.MouseOverBackColor=Color.FromArgb(242,246,251);titleButtons[i].FlatAppearance.MouseDownBackColor=Color.FromArgb(232,239,249);titleButtons[i].Click+=(s,e)=>{
                var menu=titleMenus[slot];ResetMenu(menu);
                var blank=new ToolStripMenuItem("留白（不显示任务）"){Checked=blankSlots[slot]};blank.Click+=(ss,ee)=>{blankSlots[slot]=true;selectedIds[slot]=null;RenderSlot(slot);};menu.Items.Add(blank);menu.Items.Add(new ToolStripSeparator());
                foreach(var row in conversations){var id=Str(row,"id");var item=new ToolStripMenuItem((row.ContainsKey("current")&&!Convert.ToBoolean(row["current"])?"[历史] ":"")+Str(row,"taskName")){Checked=id==selectedIds[slot]};item.Click+=(ss,ee)=>{blankSlots[slot]=false;selectedIds[slot]=id;historyIndex[slot]=0;RenderSlot(slot);};menu.Items.Add(item);}
                if(menu.Items.Count==0)menu.Items.Add(new ToolStripMenuItem("暂无对话，请先刷新监控"){Enabled=false});
                menu.Show(titleButtons[slot],new Point(0,titleButtons[slot].Height));
            };
            historyButtons[i]=new Button {Dock=DockStyle.Fill,Text="最新信息  ▾",TextAlign=ContentAlignment.MiddleLeft,FlatStyle=FlatStyle.Flat,ForeColor=Color.SteelBlue,BackColor=Color.White};historyButtons[i].FlatAppearance.BorderSize=0;
            historyButtons[i].Click+=(s,e)=>{
                var menu=historyMenus[slot];ResetMenu(menu);var messages=messageHistory[slot]??new List<string>();
                for(int index=0;index<messages.Count;index++){int target=index;string preview=messages[index].Replace("\n"," ");if(preview.Length>48)preview=preview.Substring(0,48)+"…";var item=new ToolStripMenuItem((index==0?"最新信息":"历史信息 "+index)+" · "+preview){Checked=historyIndex[slot]==index};item.Click+=(ss,ee)=>{historyIndex[slot]=target;ShowMessage(slot);};menu.Items.Add(item);}
                if(menu.Items.Count==0)menu.Items.Add(new ToolStripMenuItem("暂无历史信息"){Enabled=false});menu.Show(historyButtons[slot],new Point(0,historyButtons[slot].Height));
            };
            layout.Controls.Add(titleButtons[i],0,0);layout.Controls.Add(statePanel,0,1);layout.Controls.Add(modes[i],0,2);layout.Controls.Add(historyButtons[i],0,3);layout.Controls.Add(details[i],0,4);pushChecks[i]=new CheckBox{Dock=DockStyle.Fill,Text="推送此任务",Checked=true};pushChecks[i].CheckedChanged+=(s,e)=>{if(updatingPush||selectedIds[slot]==null)return;if(pushChecks[slot].Checked)mutedTasks.Remove(selectedIds[slot]);else mutedTasks.Add(selectedIds[slot]);SavePolicy();};layout.Controls.Add(pushChecks[i],0,5);layout.Controls.Add(directories[i],0,6);
            stripes[i]=new Panel {Dock=DockStyle.Left,Width=5,BackColor=Color.LightGray};card.Controls.Add(layout);card.Controls.Add(stripes[i]);sessions.Controls.Add(card,i,0);
        }
    }
    static void ResetMenu(ContextMenuStrip menu){menu.Close();foreach(ToolStripItem item in menu.Items.Cast<ToolStripItem>().ToArray()){menu.Items.Remove(item);item.Dispose();}}
    static string StateText(Dictionary<string,object> row) {
        string text="状态未接入";
        if(row.ContainsKey("status")&&row["status"] is Dictionary<string,object>) {
            var rs=(Dictionary<string,object>)row["status"];text=Str(rs,"type");
            if(rs.ContainsKey("activeFlags")){var flags=((IEnumerable)rs["activeFlags"]).Cast<object>().Select(Convert.ToString).ToArray();if(flags.Length>0)text=string.Join(", ",flags);}
        }
        return text.Replace("waitingOnApproval","等待授权").Replace("waitingOnUserInput","等待答复").Replace("active","执行中").Replace("idle","空闲").Replace("systemError","异常").Replace("completed","任务完成").Replace("interrupted","任务中断").Replace("notLoaded","未加载");
    }
    static Color StateColor(string state){return state.Contains("异常")||state.Contains("失败")?Color.Firebrick:state.Contains("授权")||state.Contains("答复")?Color.DarkOrange:state.Contains("完成")?Color.RoyalBlue:state.Contains("执行")?Color.ForestGreen:Color.Gray;}
    void RenderSlot(int slot) {
        updatingPush=true;pushChecks[slot].Enabled=selectedIds[slot]!=null&&!selectedIds[slot].StartsWith("pid:");pushChecks[slot].Checked=selectedIds[slot]==null||!mutedTasks.Contains(selectedIds[slot]);updatingPush=false;
        var row=conversations.FirstOrDefault(r=>Str(r,"id")==selectedIds[slot]);
        if(row==null){names[slot].Text="暂无对话";titleButtons[slot].Text="选择对话  ▾";messageHistory[slot]=new List<string>();historyButtons[slot].Enabled=false;badges[slot].Text="● 暂无任务";monitorBadges[slot].Text=monitoring?"监听已开启":"未监控";monitorBadges[slot].ForeColor=Color.Gray;badges[slot].ForeColor=Color.Gray;modes[slot].Text="尚未选择对话";SetBubbles(details[slot],new[]{"点击上方按钮刷新发现对话，再选择要查看的任务。"});directories[slot].Text="";stripes[slot].BackColor=Color.LightGray;return;}
        string state=StateText(row);
        bool historical=row.ContainsKey("current")&&!Convert.ToBoolean(row["current"]);
        bool live=monitoring&&!historical;
        Color color=StateColor(state);
        monitorBadges[slot].Text=monitoring?(historical?"历史记录 · 非当前窗口":"监听中"):"未监控 · 状态为上次检测结果";
        monitorBadges[slot].ForeColor=live?Color.ForestGreen:Color.Gray;
        string stateCaption=live?state:"上次："+state;
        names[slot].Text=Str(row,"taskName");titleButtons[slot].Text=Str(row,"taskName")+"  ▾";badges[slot].Text="● "+stateCaption;badges[slot].ForeColor=color;stripes[slot].BackColor=live||state.Contains("完成")||state.Contains("异常")?color:Color.Gray;
        modes[slot].Text=(live?"监听中":monitoring?"历史记录":"未监控")+" · "+Str(row,"mode").Replace(" · "," / ")+(TaskPushEnabled(row)?"":" · 已静音");
        var messages=new List<string>();
        string latest=Str(row,"progress");if(!string.IsNullOrWhiteSpace(latest))messages.Add(latest);
        if(row.ContainsKey("rounds"))foreach(var raw in ((IEnumerable)row["rounds"]).Cast<object>().Reverse()){
            string text=Str((Dictionary<string,object>)raw,"text");if(!string.IsNullOrWhiteSpace(text)&&!messages.Contains(text)&&!latest.Contains(text))messages.Add(text);
        }
        string previousText=messageHistory[slot]!=null&&historyIndex[slot]<messageHistory[slot].Count?messageHistory[slot][historyIndex[slot]]:null;
        bool sameTask=displayedTaskIds[slot]==selectedIds[slot];int retained=sameTask&&historyIndex[slot]>0&&previousText!=null?messages.IndexOf(previousText):0;
        messageHistory[slot]=messages;historyIndex[slot]=Math.Max(0,retained);displayedTaskIds[slot]=selectedIds[slot];historyButtons[slot].Enabled=messages.Count>1;ShowMessage(slot);directories[slot].Text=Str(row,"cwd");

    }
    void ShowMessage(int slot){
        var messages=messageHistory[slot]??new List<string>();int index=Math.Min(historyIndex[slot],Math.Max(0,messages.Count-1));
        var task=conversations.FirstOrDefault(r=>Str(r,"id")==selectedIds[slot]);string receipt="";
        if(index==0&&task!=null&&task.ContainsKey("lastPush")&&task["lastPush"] is Dictionary<string,object>){var pushed=(Dictionary<string,object>)task["lastPush"];if(Str(pushed,"text")==Str(task,"progress")&&pushed.ContainsKey("sentAt")){var when=new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddMilliseconds(Convert.ToDouble(pushed["sentAt"])).ToLocalTime();receipt=" · "+when.ToString("HH:mm:ss")+" 已推送";}}
        historyButtons[slot].Text=(index==0?"最新信息":"历史信息 "+index)+(messages.Count>1?" · 查看历史 ▾":"")+receipt;
        SetBubbles(details[slot],new[]{messages.Count>0?messages[index]:"尚未获取到任务进展。"});
        foreach(Label message in details[slot].Controls.OfType<Label>()){message.BackColor=index==0?Color.FromArgb(242,246,251):Color.FromArgb(246,247,249);message.BorderStyle=BorderStyle.None;message.Padding=new Padding(14);}
        historyButtons[slot].ForeColor=Color.FromArgb(45,103,180);
    }
    void UpdateConversations(List<Dictionary<string,object>> rows) {
        string signature=json.Serialize(rows);if(signature==cardsSignature)return;cardsSignature=signature;conversations=rows;
        updatingSelectors=true;
        try {
            var ids=new HashSet<string>(rows.Select(r=>Str(r,"id")));
            for(int i=0;i<3;i++) {
                if(selectedIds[i]!=null&&!ids.Contains(selectedIds[i]))selectedIds[i]=null;
                if(selectedIds[i]==null&&!blankSlots[i]){var candidate=rows.FirstOrDefault(r=>(!r.ContainsKey("current")||Convert.ToBoolean(r["current"]))&&!selectedIds.Contains(Str(r,"id")));if(candidate!=null)selectedIds[i]=Str(candidate,"id");}
                string oldChoices=string.Join("|",selectors[i].Items.Cast<Choice>().Select(c=>c.Id+":"+c.Title));
                string newChoices=string.Join("|",rows.Select(r=>Str(r,"id")+":"+Str(r,"taskName")));
                if(oldChoices!=newChoices){selectors[i].BeginUpdate();selectors[i].Items.Clear();foreach(var row in rows)selectors[i].Items.Add(new Choice{Id=Str(row,"id"),Title=Str(row,"taskName")});selectors[i].EndUpdate();}
                selectors[i].SelectedIndex=rows.FindIndex(r=>Str(r,"id")==selectedIds[i]);RenderSlot(i);
            }
        }finally{updatingSelectors=false;}
    }
    static string CleanDisplay(string text){
        text=System.Text.RegularExpressions.Regex.Replace(text??"",@"\[([^\]]+)\]\([^\r\n]*?\)","$1");
        text=System.Text.RegularExpressions.Regex.Replace(text,@"<oai-mem-citation>[\s\S]*?</oai-mem-citation>","");
        return text.Replace("**","").Replace("~~~","").Replace("```","").Replace("`","").Trim();
    }
    string FitMessage(string text,Font font,Size area){
        text=CleanDisplay(text);var flags=TextFormatFlags.WordBreak|TextFormatFlags.NoPrefix|TextFormatFlags.TextBoxControl;
        if(TextRenderer.MeasureText(text,font,new Size(area.Width,0),flags).Height<=area.Height)return text;
        int low=0,high=text.Length;string suffix="…（内容已截取）";
        while(low<high){int mid=(low+high+1)/2;if(TextRenderer.MeasureText(text.Substring(0,mid)+suffix,font,new Size(area.Width,0),flags).Height<=area.Height)low=mid;else high=mid-1;}
        string prefix=text.Substring(0,low);int end=prefix.LastIndexOfAny(new[]{'。','！','？','!','?'});if(end>=low*2/3)prefix=prefix.Substring(0,end+1);
        return prefix+suffix;
    }
    void ResizeBubbles(FlowLayoutPanel panel){foreach(Label label in panel.Controls.OfType<Label>()){
        label.Width=Math.Max(100,panel.ClientSize.Width);label.Height=Math.Max(30,panel.ClientSize.Height);
        label.Text=FitMessage(Convert.ToString(label.Tag),label.Font,new Size(Math.Max(60,label.Width-30),Math.Max(10,label.Height-30)));
        label.Height=Math.Min(panel.ClientSize.Height,Math.Max(72,TextRenderer.MeasureText(label.Text,label.Font,new Size(Math.Max(60,label.Width-30),0),TextFormatFlags.WordBreak|TextFormatFlags.NoPrefix|TextFormatFlags.TextBoxControl).Height+30));
    }}
    void SetBubbles(FlowLayoutPanel panel,IEnumerable<string> texts){
        string text=texts.FirstOrDefault()??"";if(Convert.ToString(panel.Tag)==text){ResizeBubbles(panel);return;}panel.Tag=text;
        panel.SuspendLayout();foreach(Control c in panel.Controls.Cast<Control>().ToArray()){panel.Controls.Remove(c);c.Dispose();}
        var label=new Label{Tag=text,AutoSize=false,Padding=new Padding(14),Margin=Padding.Empty,BackColor=Color.FromArgb(242,246,251),ForeColor=Color.FromArgb(45,58,76),Font=new Font(Font.FontFamily,10.5f)};
        panel.Controls.Add(label);ResizeBubbles(panel);panel.ResumeLayout();
    }
    void UpdateLogs(IEnumerable<string> lines){
        string content=string.Join(Environment.NewLine,lines);if(content==lastLogText)return;
        string anchor=logs.Lines.Length>0?logs.Lines[Math.Max(0,Math.Min(logs.Lines.Length-1,logs.GetLineFromCharIndex(logs.GetCharIndexFromPosition(new Point(2,2)))))]:null;
        bool atTop=logs.GetCharIndexFromPosition(new Point(2,2))<5;
        lastLogText=content;logs.SuspendLayout();logs.Clear();
        foreach(string line in lines){logs.SelectionColor=line.Contains("失败")||line.Contains("异常")?Color.Firebrick:line.Contains("已接收")||line.Contains("发送成功")?Color.ForestGreen:line.Contains("授权")||line.Contains("等待")?Color.DarkOrange:Color.SteelBlue;logs.AppendText(line+Environment.NewLine);}
        int pos=atTop||anchor==null?0:logs.Text.IndexOf(anchor,StringComparison.Ordinal);logs.Select(Math.Max(0,pos),0);logs.ScrollToCaret();logs.ResumeLayout();
    }
    void SetupButton(Button button,string text,int x) {
        button.Text=text; button.SetBounds(x,138,180,38); button.FlatStyle=FlatStyle.Flat;
        button.BackColor=button==start?Color.FromArgb(45,103,210):Color.White;button.ForeColor=button==start?Color.White:ForeColor;button.FlatAppearance.BorderColor=Color.FromArgb(200,210,225); Controls.Add(button);
    }
    static string FindNode(Dictionary<string,object> config){
        var paths=new List<string>{Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"runtime","node.exe"),Str(config,"nodePath")};
        foreach(string dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(Path.PathSeparator))paths.Add(Path.Combine(dir,"node.exe"));
        return paths.FirstOrDefault(File.Exists);
    }
    bool EnsureDevice(){if(string.IsNullOrEmpty(Str(json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"config.json"))),"pushBaseUrl"))){settingsPanel.Visible=true;settingsToggle.Text="推送设置 ▾";deviceId.Focus();status.Text="请先填写 MeoW 设备 ID 并保存。";return false;}return true;}
    void LoadPolicy(Dictionary<string,object> config){
        if(!config.ContainsKey("pushPolicy"))return;var p=(Dictionary<string,object>)config["pushPolicy"];
        if(p.ContainsKey("sources")){var src=(Dictionary<string,object>)p["sources"];foreach(var key in sourcePush.Keys.ToArray())if(src.ContainsKey(key))sourcePush[key]=Convert.ToBoolean(src[key]);}
        if(p.ContainsKey("mutedTasks"))foreach(var id in (IEnumerable)p["mutedTasks"])mutedTasks.Add(Convert.ToString(id));
    }
    bool TaskPushEnabled(Dictionary<string,object> row){string id=Str(row,"id");string group=id.StartsWith("dsh:")?"DSH":id.StartsWith("custom:")?"DIY":"Codex";return sourcePush[group]&&!mutedTasks.Contains(id);}
    void SavePolicy(){
        if(selfTesting){for(int i=0;i<3;i++)RenderSlot(i);return;}
        try{string file=Path.Combine(root,"config.json");var config=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));config["pushPolicy"]=new Dictionary<string,object>{{"sources",sourcePush},{"mutedTasks",mutedTasks.ToArray()}};string folder=Path.Combine(root,"备份","推送规则");Directory.CreateDirectory(folder);File.Copy(file,Path.Combine(folder,"config-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")+".json"));File.WriteAllText(file+".tmp",json.Serialize(config),new System.Text.UTF8Encoding(false));File.Replace(file+".tmp",file,null);File.WriteAllText(Path.Combine(data,"refresh.request"),"refresh");for(int i=0;i<3;i++)RenderSlot(i);}catch(Exception ex){MessageBox.Show(ex.Message,"推送规则保存失败");}
    }
    Process Launch(string args,bool capture) {
        if(string.IsNullOrEmpty(nodePath)||!File.Exists(nodePath))throw new Exception("找不到运行时，请完整解压便携包，保留 runtime 文件夹。");
        var info=new ProcessStartInfo(nodePath,"\""+Path.Combine(root,"notifier.mjs")+"\" "+args) {
            WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true,
            RedirectStandardOutput=capture, RedirectStandardError=capture, StandardOutputEncoding=capture?System.Text.Encoding.UTF8:null, StandardErrorEncoding=capture?System.Text.Encoding.UTF8:null
        };
        return Process.Start(info);
    }
    bool Running() {
        try {
            int id;using(var stream=new FileStream(Path.Combine(data,"monitor.lock"),FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))using(var reader=new StreamReader(stream))id=int.Parse(reader.ReadToEnd());
            using(var p=Process.GetProcessById(id)) return !p.HasExited&&p.ProcessName.Equals("node",StringComparison.OrdinalIgnoreCase);
        }catch {return false;}
    }
    async Task StartMonitor() {
        if(!EnsureDevice())return;
        start.Enabled=false;
        try {
            File.Delete(Path.Combine(data,"stop.request"));
            Process launched=null;
            if(!Running()) {workerError="";File.Delete(Path.Combine(data,"startup-error.log"));worker=Launch("",true);launched=worker;ownsWorker=true;worker.OutputDataReceived+=(s,e)=>{};worker.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)workerError+=e.Data+Environment.NewLine;};worker.BeginOutputReadLine();worker.BeginErrorReadLine();} else File.WriteAllText(Path.Combine(data,"refresh.request"),"refresh");
            statusStamp=DateTime.MinValue;
            status.Text="监控已启动，正在读取会话…";
            for(int i=0;i<20;i++){await Task.Delay(250);if(File.Exists(Path.Combine(data,"status.json"))&&File.GetLastWriteTimeUtc(Path.Combine(data,"status.json"))>DateTime.UtcNow.AddSeconds(-10)&&Running())break;if(launched!=null&&launched.HasExited&&!Running()){await Task.Delay(100);string failure=workerError.Trim();if(failure.Length==0&&File.Exists(Path.Combine(data,"startup-error.log")))failure=File.ReadAllText(Path.Combine(data,"startup-error.log"));throw new Exception(failure.Length>0?failure:"后台退出（代码 "+launched.ExitCode+"），未返回错误详情。");}}await RefreshStatus();
        }catch(Exception e){status.ForeColor=Color.Firebrick;status.Text="启动失败："+e.Message;start.Enabled=true;}
    }
    void RequestStop() {
        try {File.WriteAllText(Path.Combine(data,"stop.request"),"stop");status.Text="正在停止，将在当前检测或推送结束后退出…";}
        catch(Exception e){status.Text="停止失败："+e.Message;}
    }
    async Task TestPush() {
        if(!EnsureDevice())return;
        test.Enabled=false;test.Text="发送中…";
        try {
            using(var p=Launch("--test-push",true)) {
                Task<string> output=p.StandardOutput.ReadToEndAsync(),error=p.StandardError.ReadToEndAsync();
                await Task.Run(()=>p.WaitForExit());
                string result=p.ExitCode==0?await output:await error;
                MessageBox.Show(this,p.ExitCode==0?"测试通知已提交推送服务，请查看手机。":result,"测试推送结果",MessageBoxButtons.OK,p.ExitCode==0?MessageBoxIcon.Information:MessageBoxIcon.Warning);
            }
        }catch(Exception e){MessageBox.Show(this,e.Message,"推送失败");}
        finally{test.Enabled=true;test.Text="测试推送";}
    }
    static string Str(IDictionary<string,object> obj,string key) {return obj.ContainsKey(key)?Convert.ToString(obj[key]):"";}
    async Task RefreshStatus() {
        if(refreshing||closing)return;refreshing=true;
        try {
            bool running=Running();if(monitoring!=running){monitoring=running;cardsSignature="";for(int i=0;i<3;i++)RenderSlot(i);}status.ForeColor=running?Color.ForestGreen:Color.Gray;start.Enabled=true;start.Text=running?"刷新监控对话":"刷新并开始监控";stop.Enabled=running;
            string file=Path.Combine(data,"status.json");
            DateTime stamp=File.Exists(file)?File.GetLastWriteTimeUtc(file):DateTime.MinValue;
            if(stamp!=DateTime.MinValue && (stamp!=statusStamp||previousRunning!=running)) {
                statusStamp=stamp;previousRunning=running;
                var state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
                bool connected=state.ContainsKey("connected")&&Convert.ToBoolean(state["connected"]);
                status.Text=!running?"监听已停止。点击“刷新并开始监控”恢复。":"监控运行中 · Codex "+(connected?"已连接":"共享服务未连接")+" · DSH 日志检测 · 待推送："+Str(state,"queue");
                if(running&&(!string.IsNullOrEmpty(Str(state,"dshError"))||!string.IsNullOrEmpty(Str(state,"apiError")))){status.ForeColor=Color.Firebrick;status.Text+=" · 接入异常（见日志）";}
                var rows=new List<Dictionary<string,object>>();
                foreach(var value in (IEnumerable)state["sessions"])rows.Add((Dictionary<string,object>)value);
                if(state.ContainsKey("processes")&&!rows.Any(r=>Str(r,"mode").Contains("本地")))foreach(var raw in (IEnumerable)state["processes"]){var p=(Dictionary<string,object>)raw;if(Str(p,"kind")=="independent")rows.Add(new Dictionary<string,object>{{"id","pid:"+Str(p,"pid")},{"taskName","独立 Codex · PID "+Str(p,"pid")},{"mode","独立会话（--no-daemon）"},{"progress","进程已发现。完成提醒通过本地记录检测；授权状态及任务关联尚未接入。"}});}
                UpdateConversations(rows);
                var processes=state.ContainsKey("processes")?((IEnumerable)state["processes"]).Cast<object>().ToArray():new object[0];
                processStatus.Text="当前任务："+rows.Count+" · Codex 进程："+processes.Length+" · "+Str(state,"refreshInfo")+" · 接口 "+(string.IsNullOrEmpty(Str(state,"api"))?"未开启":new Uri(Str(state,"api")).Port.ToString());
            }else if(!running)status.Text="尚未监听。点击“刷新并开始监控”发现对话并启用推送。";

            var logFile=Path.Combine(data,"events.log");
            DateTime newLogStamp=File.Exists(logFile)?File.GetLastWriteTimeUtc(logFile):DateTime.MinValue;
            if(newLogStamp!=DateTime.MinValue&&newLogStamp!=logStamp){logStamp=newLogStamp;var lines=await Task.Run(()=>File.ReadAllLines(logFile));UpdateLogs(lines.Reverse().Take(1000));}
        }catch(Exception e){if(!closing)status.Text="正在等待检测数据… "+e.Message;}
        finally{refreshing=false;}
    }
    async void OnClosing(object sender,FormClosingEventArgs e) {
        if(closing)return;
        if(!ownsWorker){timer.Stop();return;}
        e.Cancel=true;closing=true;timer.Stop();start.Enabled=stop.Enabled=test.Enabled=false;RequestStop();
        await Task.Run(()=>{if(worker!=null)try{worker.WaitForExit(15000);}catch{}});
        Close();
    }
    public void SmokeTest() {
        selfTesting=true; monitoring=true; Show(); Application.DoEvents(); CreateControl();foreach(Control c in Controls)c.CreateControl();
        string longPreview=FitMessage(string.Concat(Enumerable.Repeat("当前阶段已经完成配置和接口验证，接下来继续检查。",100)),Font,new Size(300,130));if(!longPreview.Contains("内容已截取")||TextRenderer.MeasureText(longPreview,Font,new Size(300,0),TextFormatFlags.WordBreak|TextFormatFlags.NoPrefix|TextFormatFlags.TextBoxControl).Height>130)throw new Exception("正文截取超出空间");
        if(Controls.Count<8)throw new Exception("窗口控件初始化失败");
        string testLock=Path.Combine(data,"shared-read-selftest.lock");using(var writer=new FileStream(testLock,FileMode.Create,FileAccess.ReadWrite,FileShare.ReadWrite|FileShare.Delete)){var bytes=System.Text.Encoding.UTF8.GetBytes("123");writer.Write(bytes,0,bytes.Length);writer.Flush();using(var readerStream=new FileStream(testLock,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))using(var reader=new StreamReader(readerStream))if(reader.ReadToEnd()!="123")throw new Exception("共享锁读取失败");}File.Delete(testLock);
        var demo=new List<Dictionary<string,object>>();
        for(int i=0;i<6;i++)demo.Add(new Dictionary<string,object>{{"id","demo"+i},{"taskName",i==0?"示例任务：生成项目报告":i==1?"示例任务：检查测试结果":"示例对话 "+(i+1)},{"mode","共享后台 · 授权和完成提醒"},{"status",new Dictionary<string,object>{{"type",i==2?"idle":"active"},{"activeFlags",i==1?new string[]{"waitingOnApproval"}:new string[0]}}},{"progress","正在验证任务卡片布局、对话切换和低频刷新。正文会在卡片内自动换行，长内容自动截取。"},{"cwd",root}});
        demo[0]["rounds"]=new object[]{new Dictionary<string,object>{{"text","较早信息：已经完成配置检查。"}},new Dictionary<string,object>{{"text","最新信息：正在验证界面与日志显示。"}}};demo[0]["progress"]="最新信息：正在验证界面与日志显示。";
        if(StateColor("等待授权")!=Color.DarkOrange||StateColor("执行中")!=Color.ForestGreen||StateColor("任务完成")!=Color.RoyalBlue||StateColor("异常")!=Color.Firebrick||StateColor("未监控")!=Color.Gray)throw new Exception("状态颜色映射失败");
        UpdateConversations(demo);
        if(details[0].Controls[0].BackColor!=Color.FromArgb(242,246,251))throw new Exception("最新消息背景缺失");
        if(details[0].Controls.Count!=1||!details[0].Controls[0].Text.Contains("最新信息"))throw new Exception("最新信息未排在顶部");
        demo[0]["status"]=new Dictionary<string,object>{{"type","active"},{"activeFlags",new string[]{"waitingOnApproval"}}};RenderSlot(0);if(stripes[0].BackColor!=Color.DarkOrange)throw new Exception("授权颜色失败");demo[0]["status"]=new Dictionary<string,object>{{"type","active"},{"activeFlags",new string[0]}};RenderSlot(0);if(stripes[0].BackColor!=Color.ForestGreen||badges[0].ForeColor!=Color.ForestGreen)throw new Exception("授权后执行颜色失败");
        historyIndex[0]=1;ShowMessage(0);if(!details[0].Controls[0].Text.Contains("较早信息"))throw new Exception("历史切换失败");historyIndex[0]=0;ShowMessage(0);
        for(int cycle=0;cycle<5;cycle++){
            titleButtons[0].PerformClick();Application.DoEvents();titleMenus[0].Close();Application.DoEvents();
            titleButtons[0].PerformClick();Application.DoEvents();((ToolStripMenuItem)titleMenus[0].Items[2]).PerformClick();titleMenus[0].Close();Application.DoEvents();
            historyButtons[0].PerformClick();Application.DoEvents();historyMenus[0].Close();Application.DoEvents();
            historyButtons[0].PerformClick();Application.DoEvents();((ToolStripMenuItem)historyMenus[0].Items[1]).PerformClick();historyMenus[0].Close();Application.DoEvents();
            historyIndex[0]=0;ShowMessage(0);
        }
        monitoring=false;for(int i=0;i<3;i++)RenderSlot(i);if(monitorBadges.Any(b=>b.ForeColor!=Color.Gray)||badges.Any(b=>!b.Text.Contains("上次")))throw new Exception("暂停状态未与任务状态分开");
        demo[0]["status"]=new Dictionary<string,object>{{"type","completed"}};RenderSlot(0);if(badges[0].ForeColor!=Color.RoyalBlue||monitorBadges[0].ForeColor!=Color.Gray||stripes[0].BackColor!=Color.RoyalBlue)throw new Exception("完成状态在暂停后丢失");demo[0]["status"]=new Dictionary<string,object>{{"type","active"}};monitoring=true;for(int i=0;i<3;i++)RenderSlot(i);
        if(titleMenus[0].IsDisposed||historyMenus[0].IsDisposed)throw new Exception("菜单提前释放");
        selectors[0].SelectedIndex=5;if(selectedIds[0]!="demo5")throw new Exception("对话切换失败");selectors[0].SelectedIndex=0;
        if(selectors.Any(c=>c.Items.Count!=6)||details.Any(c=>c.Controls.Count==0))throw new Exception("三栏内容缺失");
        pushChecks[0].Checked=false;if(!mutedTasks.Contains(selectedIds[0])||TaskPushEnabled(demo[0]))throw new Exception("任务静音失败");pushChecks[0].Checked=true;sourcePush["Codex"]=false;if(TaskPushEnabled(demo[0]))throw new Exception("来源静音失败");sourcePush["Codex"]=true;
        blankSlots[2]=true;selectedIds[2]=null;RenderSlot(2);cardsSignature="";UpdateConversations(demo);if(selectedIds[2]!=null)throw new Exception("刷新填充了留白卡片");blankSlots[2]=false;cardsSignature="";UpdateConversations(demo);
        var chosen=(string[])selectedIds.Clone();UpdateConversations(demo);if(!chosen.SequenceEqual(selectedIds))throw new Exception("刷新改变了选择");
        Size=new Size(1280,940);ArrangeWindow();settingsPanel.Visible=false;settingsToggle.Text="推送设置 ▸";settingsToggle.PerformClick();if(!settingsPanel.Visible)throw new Exception("设置展开失败");settingsToggle.PerformClick();if(BuildPushAddress("example123")!="https://api.chuckfang.com/example123/")throw new Exception("地址格式失败");try{BuildPushAddress("bad/id");throw new Exception("无效 ID 被接受");}catch(Exception error){if(error.Message=="无效 ID 被接受")throw;}UpdateLogs(new[]{"2025/01/01 14:20:10 推送服务已接收：任务完成 · 示例任务：生成项目报告","2025/01/01 14:20:09 检测到：任务完成 · 示例任务：生成项目报告","2025/01/01 14:18:20 检测到：Codex 需要授权 · 示例任务：检查测试结果","2025/01/01 14:18:10 Codex 连接成功，正在监控授权与任务完成。"});processStatus.Text="当前对话：6 · 已发现进程：4 · 状态检测 8 秒 · 进展/进程 30 秒";
        if(!logs.Text.StartsWith("2025/01/01 14:20:10"))throw new Exception("日志倒序内容缺失");
        Application.DoEvents();
        using(var image=new Bitmap(ClientSize.Width,ClientSize.Height)){DrawToBitmap(image,new Rectangle(Point.Empty,ClientSize));image.Save(Path.Combine(data,"desktop-preview.png"));}
        settingsToggle.PerformClick();Application.DoEvents();using(var image=new Bitmap(ClientSize.Width,ClientSize.Height)){DrawToBitmap(image,new Rectangle(Point.Empty,ClientSize));image.Save(Path.Combine(data,"settings-preview.png"));}settingsToggle.PerformClick();
        File.WriteAllText(Path.Combine(data,"desktop-selftest.log"),"桌面窗口控件初始化通过；原生 Windows Forms；无 CMD 或 PowerShell 界面依赖。",System.Text.Encoding.UTF8);
    }
    protected override void Dispose(bool disposing){if(disposing){timer.Dispose();foreach(var menu in titleMenus.Concat(historyMenus))if(menu!=null)menu.Dispose();if(worker!=null)worker.Dispose();}base.Dispose(disposing);}
}
static class Program {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        try {
            using(var window=new ReminderWindow()) {
                if(args.Contains("--self-test")){window.SmokeTest();return;}
                bool created;
                using(var mutex=new Mutex(true,"Local\\GPTNotifierDesktop",out created)) {
                    if(!created){MessageBox.Show("鸿蒙设备信息推送工具窗口已经打开，请在任务栏中找到它。","鸿蒙设备信息推送工具");return;}
                    Application.Run(window);
                }
            }
        }catch(Exception e){
            if(args.Contains("--self-test")){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"运行记录","desktop-selftest-error.log"),e.ToString());Environment.ExitCode=1;}
            else MessageBox.Show(e.Message,"鸿蒙设备信息推送工具启动失败",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
    }
}
