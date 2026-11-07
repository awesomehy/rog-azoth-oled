$ErrorActionPreference = 'Stop'
$taskDirectory = $PSScriptRoot
$backgroundExe = Join-Path $taskDirectory 'AzothOLED.exe'
if (Test-Path -LiteralPath $backgroundExe) {
    Start-Process -FilePath $backgroundExe -ArgumentList '--stop' -WindowStyle Hidden -Wait
}
New-Item -ItemType Directory -Path (Join-Path $taskDirectory '.local') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskDirectory '.local\stop') -Value 'stop'
$statusFile = Join-Path $taskDirectory '.local\status.json'
$restored = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-Path -LiteralPath $statusFile) {
        $appStatus = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
        if ($appStatus.state -eq 'stopped' -and $appStatus.restored) { $restored = $true; break }
        if (-not (Get-Process -Id $appStatus.pid -ErrorAction SilentlyContinue)) { break }
    } else { break }
    Start-Sleep -Milliseconds 500
}
if ($restored -and (Test-Path -LiteralPath (Join-Path $taskDirectory '.local\boot-hardware.json'))) { $restored = $false }
if ($restored) {
    Write-Host '已停止，并恢复原来的温度页面和拨杆映射。'
} elseif (Test-Path -LiteralPath (Join-Path $taskDirectory '.local\restore.json')) {
    if ($appStatus -and (Get-Process -Id $appStatus.pid -ErrorAction SilentlyContinue)) {
        throw '程序仍在运行，请稍后再试。详细信息见 .local\app.log。'
    }
    Push-Location -LiteralPath $taskDirectory
    $packagedEngine = Join-Path $taskDirectory 'runtime\azoth-engine.exe'
    $engineExecutable = if (Test-Path -LiteralPath $packagedEngine) { $packagedEngine } else { (Get-Command node).Source }
    try { & $engineExecutable 'src/recover.mjs' } finally { Pop-Location }
}
