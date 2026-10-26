# 把整个数据目录挪到别的盘（C 盘放不下时用）
#
#   .\scripts\move-data.ps1 -Target 'D:\qqbot-data' -WhatIf
#   .\scripts\move-data.ps1 -Target 'D:\qqbot-data'
#   .\scripts\move-data.ps1 -Target 'D:\qqbot-data' -Move     # 移动而不是复制
#
# 原理：默认目录 <DSH_HOME>\storages\dsh-qqbot-refine 里留一个 .data-path 指针文件，
#       插件启动时读它来决定 data 目录；所以「默认目录」始终存在但几乎为空。
#
# 改完要重启 DSH。

param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$Move,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$src = Join-Path $home_ 'storages\dsh-qqbot-refine'

if (-not (Test-Path $src)) { throw "默认数据目录不存在：$src" }
if (-not [System.IO.Path]::IsPathRooted($Target)) { throw "Target 需要绝对路径，例如 D:\qqbot-data" }

Write-Host "源目录： $src"
Write-Host "目标：   $Target"
Write-Host ("模式：   " + $(if ($Move) { '移动（源目录清空，只留指针）' } else { '复制（源目录保留）' }))
if ($WhatIf) { Write-Host '（-WhatIf：只看不动）' }

# 估算大小
$size = (Get-ChildItem $src -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
Write-Host ("大小：   " + [math]::Round($size / 1MB, 1) + " MB")
Write-Host ''

if (Test-Path $Target) {
  $has = (Get-ChildItem $Target -Force | Measure-Object).Count
  if ($has -gt 0) { throw "目标目录不是空的：$Target（换一个，或先自己清空）" }
} elseif (-not $WhatIf) {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
}

if (-not $WhatIf) {
  if ($Move) {
    # 同盘 Move-Item 很快；跨盘其实是复制+删，慢一点但安全
    Get-ChildItem $src -Force | Where-Object { $_.Name -ne '.data-path' } | ForEach-Object {
      Move-Item -Path $_.FullName -Destination $Target -Force
    }
  } else {
    Copy-Item -Path (Join-Path $src '*') -Destination $Target -Recurse -Force
  }
  Set-Content -Path (Join-Path $src '.data-path') -Value $Target -Encoding utf8
  Write-Host '已写入指针文件： ' (Join-Path $src '.data-path')
}

Write-Host ''
Write-Host '下一步：重启 DSH。之后插件会用新目录；旧目录只留 .data-path。'
if ($Move) { Write-Host '想撤回：把文件搬回来并删掉 .data-path 即可。' }
