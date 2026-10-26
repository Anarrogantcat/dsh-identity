# 把项目目录同步到 DSH 真正加载的位置（~/.dsh/plugins/dsh-qqbot-refine）
#
#   .\scripts\sync-to-deploy.ps1            # 同步
#   .\scripts\sync-to-deploy.ps1 -WhatIf    # 只看会动哪些文件
#   .\scripts\sync-to-deploy.ps1 -Restart   # 同步完提示重启（不会自己重启 DSH）
#
# 为什么需要这一步：DSH 从 ~/.dsh/plugins 加载插件（profile 里的 junction 指向那里），
# 而项目目录在工作区。两边不会自动同步，改完记得跑一次。

param(
  [switch]$WhatIf,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $env:USERPROFILE '.dsh\plugins\dsh-qqbot-refine'
$link = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-qqbot-refine'

if (-not (Test-Path $dst)) { throw "部署目录不存在：$dst" }

# 只同步运行需要的文件；docs/ test/ scripts/ .git 不进部署目录
$files = @('index.js', 'client.js', 'panel.html', 'cordis.patch.yml', 'package.json', 'README.md', 'README.en.md', 'LICENSE')

Write-Host "项目： $src"
Write-Host "部署： $dst"
Write-Host ''

$changed = 0
foreach ($f in $files) {
  $s = Join-Path $src $f
  if (-not (Test-Path $s)) { continue }
  $d = Join-Path $dst $f
  $same = (Test-Path $d) -and ((Get-FileHash $s).Hash -eq (Get-FileHash $d).Hash)
  if ($same) { continue }
  $changed++
  Write-Host ("  ~ " + $f)
  if (-not $WhatIf) { Copy-Item -Force $s $d }
}

$libSrc = Join-Path $src 'lib'
$libDst = Join-Path $dst 'lib'
if (Test-Path $libSrc) {
  foreach ($item in Get-ChildItem $libSrc -File) {
    $d = Join-Path $libDst $item.Name
    $same = (Test-Path $d) -and ((Get-FileHash $item.FullName).Hash -eq (Get-FileHash $d).Hash)
    if ($same) { continue }
    $changed++
    Write-Host ("  ~ lib/" + $item.Name)
    if (-not $WhatIf) { Copy-Item -Force $item.FullName $d }
  }
}

Write-Host ''
if ($changed -eq 0) { Write-Host '已经是最新，没有需要同步的文件。' }
elseif ($WhatIf) { Write-Host ("将同步 " + $changed + " 个文件（-WhatIf 未写入）") }
else { Write-Host ("已同步 " + $changed + " 个文件。") }

# 自检：加载入口是否指向部署目录
if (Test-Path $link) {
  $t = (Get-Item $link).Target
  if ($t) { Write-Host ("加载入口： " + $t) }
  else { Write-Host '加载入口： 不是 junction（可能是真实目录），请检查' }
} else {
  Write-Host '加载入口： 不存在！profile 里没有 node_modules/dsh-qqbot-refine'
}

if ($Restart) {
  Write-Host ''
  Write-Host '提示：服务端代码变了要重启 DSH 才生效；只有 panel.html / README 变了刷新页面即可。'
}
