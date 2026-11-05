$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
[Windows.Forms.Application]::EnableVisualStyles()
$taskDirectory = $PSScriptRoot
$appConfig = Get-Content -LiteralPath (Join-Path $taskDirectory 'config.json') -Raw | ConvertFrom-Json
$usageUri = [Uri]::new([Uri]$appConfig.codexUsage.baseUrl, '/api/usage')
$form = New-Object Windows.Forms.Form
$form.Text = '键盘 OLED — 局域网额度接口 Key'
$form.ClientSize = New-Object Drawing.Size(520, 200)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$label = New-Object Windows.Forms.Label
$label.Text = "输入虚拟机服务 config.json 中的 apiKey。`n只在本机加密保存，不进入聊天、URL 或普通配置。"
$label.SetBounds(18, 15, 490, 48)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.SetBounds(18, 72, 484, 28)
$saveButton = New-Object Windows.Forms.Button
$saveButton.Text = '验证并保存'
$saveButton.SetBounds(270, 114, 110, 32)
$cancelButton = New-Object Windows.Forms.Button
$cancelButton.Text = '取消'
$cancelButton.SetBounds(392, 114, 110, 32)
$messageLabel = New-Object Windows.Forms.Label
$messageLabel.SetBounds(18, 156, 490, 32)
$form.Controls.AddRange(@($label, $inputBox, $saveButton, $cancelButton, $messageLabel))
$form.AcceptButton = $saveButton
$form.CancelButton = $cancelButton
$cancelButton.Add_Click({ $form.Close() })
$saveButton.Add_Click({
    $keyValue = $inputBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($keyValue)) { $messageLabel.Text = '请输入 API Key。'; return }
    $saveButton.Enabled = $false
    $messageLabel.Text = '正在验证局域网接口…'
    $form.Refresh()
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(25)
    try {
        $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $keyValue)
        $response = $client.GetAsync($usageUri).GetAwaiter().GetResult()
        $statusNumber = [int]$response.StatusCode
        if ($statusNumber -eq 401) { $messageLabel.Text = 'Key 不匹配（401），请核对服务端正在使用的 apiKey。'; return }
        if (-not $response.IsSuccessStatusCode) { $messageLabel.Text = "数据接口暂不可用（HTTP $statusNumber），稍后再试。"; return }
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if (-not $body.ok -or -not $body.limits) { $messageLabel.Text = '接口未返回有效额度数据，尚未保存。'; return }
        $localDirectory = Join-Path $taskDirectory '.local'
        New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
        $plainBytes = [Text.Encoding]::UTF8.GetBytes($keyValue)
        $entropy = [Text.Encoding]::UTF8.GetBytes('azoth-oled-codex-usage-v1')
        $protectedBytes = [Security.Cryptography.ProtectedData]::Protect($plainBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes((Join-Path $localDirectory 'codex-usage-key.dpapi'), $protectedBytes)
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        Set-Content -LiteralPath (Join-Path $localDirectory 'refresh-quota') -Value 'refresh'
        $inputBox.Clear()
        $form.Close()
    } catch { $messageLabel.Text = '接口连接或验证失败，请稍后重试。' }
    finally { $keyValue = $null; $client.Dispose(); $handler.Dispose(); $saveButton.Enabled = $true }
})
$form.Add_Shown({ $inputBox.Focus() })
[void]$form.ShowDialog()
$form.Dispose()
