$ErrorActionPreference = 'Stop'
$taskDirectory = $PSScriptRoot
$backgroundExe = Join-Path $taskDirectory 'AzothOLED.exe'
if (Test-Path -LiteralPath $backgroundExe) {
    Start-Process -FilePath $backgroundExe -WorkingDirectory $taskDirectory -WindowStyle Hidden
    Write-Host 'OLED 后台程序已启动，可在系统托盘管理。'
    exit
}
$statusFile = Join-Path $taskDirectory '.local\status.json'
if (Test-Path -LiteralPath $statusFile) {
    $appStatus = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
    if ($appStatus.state -ne 'stopped' -and (Get-Process -Id $appStatus.pid -ErrorAction SilentlyContinue)) {
        Write-Host 'OLED 程序已经运行。'
        exit
    }
}
New-Item -ItemType Directory -Path (Join-Path $taskDirectory '.local') -Force | Out-Null
$lockFile = Join-Path $taskDirectory '.local\app.lock'
if (Test-Path -LiteralPath $lockFile) {
    $savedProcessId = [int](Get-Content -LiteralPath $lockFile -Raw)
    if (Get-Process -Id $savedProcessId -ErrorAction SilentlyContinue) { throw 'OLED 程序已经运行或正在启动。' }
    Remove-Item -LiteralPath $lockFile
}
$nodeExecutable = (Get-Command node).Source
Start-Process -FilePath $nodeExecutable -ArgumentList @('src/app.mjs') -WorkingDirectory $taskDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskDirectory '.local\app.log') -RedirectStandardError (Join-Path $taskDirectory '.local\app-error.log')
Write-Host 'OLED 程序已启动，详细状态见 .local\status.json。'
