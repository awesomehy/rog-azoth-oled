$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'ROG Azoth OLED' -ErrorAction SilentlyContinue
if ($task) { Unregister-ScheduledTask -TaskName 'ROG Azoth OLED' -Confirm:$false }
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'ROG 夜魔 OLED.lnk'
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
Write-Output '已取消登录自启，当前运行的 OLED 程序不受影响。'
