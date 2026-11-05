$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $projectDirectory 'build\app'
$pythonExecutable = $env:AZOTH_PYTHON
if (-not $pythonExecutable) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    $pythonExecutable = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { (Get-Command python).Source }
}
$nodeExecutable = (Get-Command node).Source
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
Push-Location -LiteralPath $projectDirectory
try {
    $sourceFile = Join-Path $PSScriptRoot 'AzothOLED.cs'
    & $compiler /nologo /target:winexe /platform:x64 /codepage:65001 "/out:$buildDirectory\AzothOLED.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $sourceFile
    if ($LASTEXITCODE -ne 0) { throw '后台托盘程序编译失败。' }
    $pythonBuild = @'
import sys
sys.path.insert(0, '.tools/python')
from PyInstaller.__main__ import run
run(['--noconfirm', '--onedir', '--console', '--name', 'azoth-hid',
     '--paths', '.tools/python', '--distpath', 'build/runtime',
     '--workpath', '.tools/pyinstaller-work', '--specpath', '.tools',
     '--log-level', 'WARN', 'native/hid_bridge.py'])
'@
    $pythonBuild | & $pythonExecutable -
    if ($LASTEXITCODE -ne 0) { throw 'HID 运行时打包失败。' }
    foreach ($folder in @('src', 'native', 'assets')) {
        Copy-Item -LiteralPath (Join-Path $projectDirectory $folder) -Destination $buildDirectory -Recurse -Force
    }
    foreach ($file in @('config.json', 'README.md', '启动.ps1', '停止并恢复.ps1', '设置额度接口Key.ps1')) {
        Copy-Item -LiteralPath (Join-Path $projectDirectory $file) -Destination $buildDirectory -Force
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '取消开机自启.ps1') -Destination $buildDirectory -Force
    $runtimeDirectory = Join-Path $buildDirectory 'runtime'
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtimeDirectory 'azoth-engine.exe') -Force
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'build\runtime\azoth-hid') -Destination $runtimeDirectory -Recurse -Force
    Write-Output ('Built: ' + $buildDirectory)
} finally { Pop-Location }
