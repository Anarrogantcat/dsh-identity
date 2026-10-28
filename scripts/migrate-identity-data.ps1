# 把旧数据目录迁移到新名字（复制，不删旧；旧目录保留 30 天）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/migrate-identity-data.ps1
param([string]$From = '', [string]$To = '')
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:USERPROFILE '.dsh\storages'
if (-not $From) { $From = Join-Path $base 'dsh-qqbot-refine' }
if (-not $To) { $To = Join-Path $base 'dsh-identity' }
if (-not (Test-Path $From)) { throw "旧数据目录不存在：$From" }
New-Item -ItemType Directory -Force -Path $To | Out-Null
robocopy $From $To /E /NFL /NDL /NJH /NJS | Out-Null
Set-Content -Path (Join-Path $To '.migrated-from') -Value $From -Encoding UTF8
Write-Host "迁移完成：$From -> $To（旧目录未删除，重启 DSH 后生效）"
