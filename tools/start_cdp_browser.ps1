param([int]$Port = 9222)
# The packaged start-browser.ps1 is UTF-8 without BOM; PowerShell 5.1 misparses its Chinese strings.
# Re-save a BOM copy to a temp file and run it in a child process, leaving the installed toolchain untouched.
$src = Join-Path $PSScriptRoot ".venv\Lib\site-packages\campus_paper_fetch\data\scripts\start-browser.ps1"
$tmp = Join-Path $PSScriptRoot ".cpf-start-browser.tmp.ps1"
[IO.File]::WriteAllText($tmp, (Get-Content -Raw -Encoding UTF8 $src), (New-Object System.Text.UTF8Encoding($true)))
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Port $Port
} finally {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}
