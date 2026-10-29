# 打开「充值码专用浏览器」
#
# 为什么要专用浏览器：实时充值码要靠调试端口（CDP）去点「去支付」再截图。
# 你日常用的 Edge 没开调试端口，硬去抢它的 profile 会把窗口弄坏；
# 所以这里开一个独立 profile（登录态保存在数据目录里），登录一次就长期有效。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\pay-browser.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pay-browser.ps1 -Port 9333
#
# 打开后在窗口里登录 DeepSeek（手机验证码或微信扫码），然后就不用管了；
# 面板「用量」页把「实时充值码」打开，群里 #充值码 就会现开现截。

param(
  [int]$Port = 9333,
  [string]$Url = 'https://platform.deepseek.com/top_up',
  [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $DataDir) {
  $DataDir = Join-Path $env:USERPROFILE '.dsh\storages\dsh-identity\pay-browser'
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$candidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 msedge.exe，请先装 Edge（或用 Chrome 改这里的路径）' }

Write-Host "浏览器：$edge"
Write-Host "配置目录：$DataDir"
Write-Host "调试端口：$Port"

Start-Process -FilePath $edge -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$DataDir",
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  $Url
)

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $v = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -UseBasicParsing
    if ($v.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}

if ($ok) {
  Write-Host ''
  Write-Host '好了：调试端口已就绪。' -ForegroundColor Green
  Write-Host '请在这个窗口里登录 DeepSeek（手机验证码 / 微信扫码），登录一次就够。'
  Write-Host "登录后回到面板把 usage.payLiveEnabled 打开，群里发 #充值码 就会现开现截。"
} else {
  Write-Host '警告：调试端口没起来（可能 Edge 已经在用同一个配置目录）。' -ForegroundColor Yellow
  Write-Host '把那个窗口关掉再重跑本脚本即可。'
}
