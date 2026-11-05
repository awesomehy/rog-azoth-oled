using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string local = Path.Combine(root, ".local");
        Directory.CreateDirectory(local);
        if (args.Length > 0 && args[0] == "--stop") {
            File.WriteAllText(Path.Combine(local, "supervisor-command"), "exit");
            return 0;
        }
        bool created;
        using (var mutex = new Mutex(true, "Local\\AzothOLED-" + WindowsIdentity.GetCurrent().User.Value, out created)) {
            if (!created) return 0;
            // A stop request left while the app was already closed must not
            // immediately close the next instance during its construction.
            string staleCommand = Path.Combine(local, "supervisor-command");
            if (File.Exists(staleCommand)) File.Delete(staleCommand);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayContext(root));
        }
        return 0;
    }
}

internal sealed class TrayContext : ApplicationContext {
    private readonly string root, local, enginePath;
    private readonly NotifyIcon icon;
    private readonly System.Windows.Forms.Timer timer;
    private readonly object logLock = new object();
    private readonly ToolStripMenuItem statusItem;
    private Process engine;
    private volatile bool wanted = true, starting = false, exiting = false;
    private DateTime retryAfter = DateTime.MinValue;
    private DateTime stoppingAt = DateTime.MinValue;

    internal TrayContext(string directory) {
        root = directory; local = Path.Combine(root, ".local");
        enginePath = Path.Combine(root, "runtime", "azoth-engine.exe");
        statusItem = new ToolStripMenuItem("正在连接键盘…"); statusItem.Enabled = false;
        var menu = new ContextMenuStrip(); menu.Items.Add(statusItem); menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("启动 / 恢复多页显示", null, delegate { wanted = true; retryAfter = DateTime.MinValue; });
        menu.Items.Add("暂停并恢复原厂显示", null, delegate { Pause(); });
        menu.Items.Add("重新连接键盘", null, delegate { WriteStop(); wanted = true; retryAfter = DateTime.UtcNow.AddSeconds(2); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开设置", null, delegate { Process.Start(new ProcessStartInfo(Path.Combine(root, "config.json")) { UseShellExecute = true }); });
        menu.Items.Add("设置额度接口 Key", null, delegate { OpenKeySetup(); });
        menu.Items.Add("打开日志文件夹", null, delegate { Process.Start("explorer.exe", "\"" + local + "\""); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出并恢复原厂显示", null, delegate { exiting = true; Pause(); });
        icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "ROG 夜魔 OLED：正在启动", ContextMenuStrip = menu, Visible = true };
        timer = new System.Windows.Forms.Timer { Interval = 2000 };
        timer.Tick += delegate { Tick(); }; timer.Start();
        File.WriteAllText(Path.Combine(local, "supervisor-pid"), Process.GetCurrentProcess().Id.ToString());
        Log("background supervisor started");
    }

    private Dictionary<string, object> Status() {
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(local, "status.json"))); }
        catch { return null; }
    }
    private static string Value(Dictionary<string, object> state, string key) {
        object value; return state != null && state.TryGetValue(key, out value) && value != null ? value.ToString() : "";
    }
    private void Log(string text) {
        lock (logLock) { File.AppendAllText(Path.Combine(local, "supervisor.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine, Encoding.UTF8); }
    }
    private bool Alive(Process process) { try { return process != null && !process.HasExited; } catch { return false; } }
    private void WriteStop() {
        if (Alive(engine)) { File.WriteAllText(Path.Combine(local, "stop"), "stop"); stoppingAt = DateTime.UtcNow; }
    }
    private void Pause() { wanted = false; WriteStop(); }
    private void OpenKeySetup() {
        Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "设置额度接口Key.ps1") + "\"") { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Normal });
    }
    private void Tick() {
        string commandPath = Path.Combine(local, "supervisor-command");
        if (File.Exists(commandPath)) {
            try { string command = File.ReadAllText(commandPath).Trim(); File.Delete(commandPath); if (command == "exit") { exiting = true; Pause(); } }
            catch { }
        }
        var state = Status();
        if (exiting) {
            if (!Alive(engine) && !starting) { Finish(); return; }
            // Only terminate an engine that has already completed restoration.
            if (Alive(engine) && Value(state, "state") == "stopped" && Value(state, "restored") == "True" && DateTime.UtcNow - stoppingAt > TimeSpan.FromSeconds(12)) {
                try { engine.Kill(); } catch { }
            }
            return;
        }
        if (Alive(engine)) {
            if (Value(state, "pid") == engine.Id.ToString() && Value(state, "state") == "stopped" && Value(state, "reason") == "stopped" && stoppingAt == DateTime.MinValue) wanted = false;
            string label = wanted ? Value(state, "state") == "adjusting" ? "调整功能中" : "运行中" : "已暂停";
            statusItem.Text = label; icon.Text = "ROG 夜魔 OLED：" + label;
            return;
        }
        if (!wanted) { statusItem.Text = "已暂停，原厂设置已恢复"; icon.Text = "ROG 夜魔 OLED：已暂停"; return; }
        statusItem.Text = "正在等待键盘和 Gear Link…"; icon.Text = "ROG 夜魔 OLED：等待连接";
        if (!starting && DateTime.UtcNow >= retryAfter) {
            starting = true; retryAfter = DateTime.UtcNow.AddSeconds(10);
            Task.Run((Action)StartEngine);
        }
    }
    private Process FindOwnedEngine() {
        foreach (Process process in Process.GetProcessesByName("azoth-engine")) {
            try { if (String.Equals(process.MainModule.FileName, enginePath, StringComparison.OrdinalIgnoreCase)) return process; } catch { }
        }
        return null;
    }
    private ProcessStartInfo EngineInfo(string script) {
        return new ProcessStartInfo(enginePath, "\"" + Path.Combine(root, "src", script) + "\"") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
    }
    private void StartEngine() {
        try {
            Process owned = FindOwnedEngine(); if (owned != null) { engine = owned; return; }
            var state = Status();
            if (File.Exists(Path.Combine(local, "restore.json")) && Value(state, "restored") != "True") {
                var recovery = new Process { StartInfo = EngineInfo("recover.mjs") };
                recovery.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log("recovery: " + e.Data); };
                recovery.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log("recovery: " + e.Data); };
                recovery.Start(); recovery.BeginOutputReadLine(); recovery.BeginErrorReadLine();
                if (!recovery.WaitForExit(20000)) { recovery.Kill(); throw new Exception("recovery timeout; waiting for keyboard"); }
                if (recovery.ExitCode != 0) throw new Exception("keyboard not ready for recovery");
            }
            if (!wanted || exiting) return;
            string lockFile = Path.Combine(local, "app.lock"); if (File.Exists(lockFile)) File.Delete(lockFile);
            foreach (string file in new string[] { "app.log", "app-error.log" }) {
                string log = Path.Combine(local, file); string previous = log + ".previous";
                if (File.Exists(log) && new FileInfo(log).Length > 1048576) { if (File.Exists(previous)) File.Delete(previous); File.Move(log, previous); }
            }
            var child = new Process { StartInfo = EngineInfo("app.mjs") };
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) { lock (logLock) File.AppendAllText(Path.Combine(local, "app.log"), e.Data + Environment.NewLine, Encoding.UTF8); } };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) { lock (logLock) File.AppendAllText(Path.Combine(local, "app-error.log"), e.Data + Environment.NewLine, Encoding.UTF8); } };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            engine = child; stoppingAt = DateTime.MinValue; Log("engine started: " + child.Id);
        } catch (Exception error) { Log("waiting: " + error.Message); }
        finally { starting = false; }
    }
    private void Finish() {
        timer.Stop(); icon.Visible = false; icon.Dispose(); timer.Dispose();
        try { File.Delete(Path.Combine(local, "supervisor-pid")); } catch { }
        ExitThread();
    }
}
