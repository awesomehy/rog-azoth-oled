param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'AzothOLED'))
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $projectDirectory 'build\app'
$appExe = Join-Path $InstallDirectory 'AzothOLED.exe'
if (-not (Test-Path -LiteralPath (Join-Path $buildDirectory 'AzothOLED.exe'))) { throw '请先构建后台程序。' }
$targetPath = [IO.Path]::GetFullPath($InstallDirectory)
if ($targetPath -ne [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AzothOLED'))) { throw '安装目标必须为当前用户 LocalAppData 下的 AzothOLED 文件夹。' }
if (Test-Path -LiteralPath $appExe) {
    Start-Process -FilePath $appExe -ArgumentList '--stop' -WindowStyle Hidden -Wait
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $owned = Get-Process AzothOLED -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appExe }
        if (-not $owned) { break }; Start-Sleep -Milliseconds 500
    }
    if ($owned) { throw '旧版后台程序仍在退出，请稍后重试。' }
}
& (Join-Path $projectDirectory '停止并恢复.ps1')
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $buildDirectory -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $InstallDirectory -Recurse -Force }
$installedLocal = Join-Path $InstallDirectory '.local'
New-Item -ItemType Directory -Path $installedLocal -Force | Out-Null
$staleCommand = Join-Path $installedLocal 'supervisor-command'
if (Test-Path -LiteralPath $staleCommand) { Remove-Item -LiteralPath $staleCommand }
$savedKey = Join-Path $projectDirectory '.local\codex-usage-key.dpapi'
if (Test-Path -LiteralPath $savedKey) { Copy-Item -LiteralPath $savedKey -Destination (Join-Path $installedLocal 'codex-usage-key.dpapi') -Force }
$taskName = 'ROG Azoth OLED'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $appExe -WorkingDirectory $InstallDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$trigger.Delay = 'PT10S'
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$startupMethod = 'scheduled-task'
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '登录后启动夜魔 OLED 多页显示后台程序；虚拟机接口提供 Codex 额度。' -Force | Out-Null
} catch {
    if ($_.Exception.Message -notmatch 'denied|拒绝|0x80070005') { throw }
    $startupMethod = 'startup-shortcut'
}
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'ROG 夜魔 OLED.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath); $shortcut.TargetPath = $appExe; $shortcut.WorkingDirectory = $InstallDirectory; $shortcut.IconLocation = $appExe; $shortcut.Save()
$startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'ROG 夜魔 OLED.lnk'
if ($startupMethod -eq 'scheduled-task') {
    if (Test-Path -LiteralPath $startupShortcut) { Remove-Item -LiteralPath $startupShortcut }
    Start-ScheduledTask -TaskName $taskName
} else {
    Copy-Item -LiteralPath $shortcutPath -Destination $startupShortcut -Force
    Start-Process -FilePath $appExe -WorkingDirectory $InstallDirectory -WindowStyle Hidden
}
[IO.File]::WriteAllText((Join-Path $installedLocal 'startup.json'), (@{ method = $startupMethod; taskName = $taskName; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Output ('Installed: ' + $InstallDirectory)
Write-Output ('Startup: ' + $startupMethod)
