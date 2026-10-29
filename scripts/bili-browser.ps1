# 打开「B站专用浏览器」（给她自己的 B站 账号用）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\bili-browser.ps1
# 登录一次，登录态保存在 DSH 数据目录的 bili-browser profile 里，每个实例各用各的账号。

param(
  [int]$Port = 9444,
  [string]$Url = 'https://www.bilibili.com',
  [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
if (-not $DataDir) { $DataDir = Join-Path $env:USERPROFILE '.dsh\storages\dsh-identity\bili-browser' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$candidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 msedge.exe，请先装 Edge' }

Start-Process -FilePath $edge -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$DataDir",
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  $Url
)
Write-Host "B站专用浏览器已打开（端口 $Port，配置目录 $DataDir）。登录一次即可。"
