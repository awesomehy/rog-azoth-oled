param([Parameter(Mandatory=$true)][string]$KeyFile)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $protectedBytes = [IO.File]::ReadAllBytes($KeyFile)
    $entropy = [Text.Encoding]::UTF8.GetBytes('azoth-oled-codex-usage-v1')
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
} catch { exit 1 }
