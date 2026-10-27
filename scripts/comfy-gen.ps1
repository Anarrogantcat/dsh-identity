param(
  [Parameter(Mandatory=$true)][string]$Prompt,
  [string]$Negative = "lowres, bad anatomy, text, watermark, worst quality",
  [int]$Width = 512,
  [int]$Height = 768,
  [int]$Steps = 24,
  [double]$Cfg = 7,
  [int]$Seed = 0,
  [string]$Out = ""
)
$ErrorActionPreference = 'Stop'
$root = 'D:\AI\ComfyUI'
$py = Join-Path $root 'python\python.exe'
$main = Join-Path $root 'ComfyUI\main.py'
$wfPath = Join-Path $PSScriptRoot '..\assets\comfyui\sd15_txt2img.json'
$base = 'http://127.0.0.1:8188'

# 1) 生图前先停语音（显存让出来）
try { wsl -d Ubuntu -e bash -lc 'pkill -f tts_daemon.py' 2>$null | Out-Null } catch {}

# 2) 确保 ComfyUI 在跑
function Test-Comfy { try { $r = Invoke-WebRequest -Uri "$base/system_stats" -UseBasicParsing -TimeoutSec 3; return $r.StatusCode -eq 200 } catch { return $false } }
if (-not (Test-Comfy)) {
  Write-Host '启动 ComfyUI…'
  Start-Process -FilePath $py -ArgumentList @('-s', $main, '--port', '8188', '--listen', '127.0.0.1') -WindowStyle Hidden -WorkingDirectory (Join-Path $root 'ComfyUI')
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 2; if (Test-Comfy) { break } }
  if (-not (Test-Comfy)) { throw 'ComfyUI 启动超时（看 D:\AI\ComfyUI\ComfyUI\comfyui.log）' }
}

# 3) 组装工作流
$wf = Get-Content $wfPath -Raw | ConvertFrom-Json
$wf.'2'.inputs.text = $Prompt
$wf.'3'.inputs.text = $Negative
$wf.'4'.inputs.width = $Width
$wf.'4'.inputs.height = $Height
$wf.'5'.inputs.steps = $Steps
$wf.'5'.inputs.cfg = $Cfg
$wf.'5'.inputs.seed = $(if ($Seed -gt 0) { $Seed } else { Get-Random -Maximum 2147483647 })
$body = @{ prompt = $wf; client_id = [guid]::NewGuid().ToString() } | ConvertTo-Json -Depth 12 -Compress

# 4) 提交 + 轮询
$resp = Invoke-RestMethod -Uri "$base/prompt" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
$pid2 = $resp.prompt_id
Write-Host "已提交 prompt_id=$pid2"
$img = $null
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Milliseconds 1000
  try { $h = Invoke-RestMethod -Uri "$base/history/$pid2" -TimeoutSec 10 } catch { continue }
  $rec = $h.$pid2
  if (-not $rec) { continue }
  if ($rec.status -and $rec.status.status_str -eq 'error') { throw ('ComfyUI 执行失败：' + ($rec.status.messages | ConvertTo-Json -Compress)) }
  if ($rec.outputs) {
    foreach ($k in $rec.outputs.PSObject.Properties.Name) {
      $o = $rec.outputs.$k
      if ($o.images -and $o.images.Count -gt 0) { $img = $o.images[0]; break }
    }
  }
  if ($img) { break }
}
if (-not $img) { throw '生图超时（180 秒）' }

# 5) 下载图片
if (-not $Out) { $Out = Join-Path $env:TEMP ('comfy-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.png') }
$url = "$base/view?filename=" + [uri]::EscapeDataString($img.filename) + '&subfolder=' + [uri]::EscapeDataString($img.subfolder) + '&type=' + $img.type
Invoke-WebRequest -Uri $url -OutFile $Out -TimeoutSec 60 | Out-Null
Write-Host "已生成：$Out ($([math]::Round((Get-Item $Out).Length/1KB)) KB)"
Write-Output $Out
