param(
  [switch]$Install,
  [ValidateSet('auto','cuda','rocm')][string]$Backend = 'auto',
  [switch]$WithSvs,
  [string]$InstallDir = (Join-Path $HOME '.dsh\voice\feiyu-voice')
)
$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "[voice] $m" }

Info '检查环境…'
$gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
Info ('GPU: ' + ($gpu -join ' / '))
$wsl = wsl --list --verbose 2>$null
if (-not $wsl) { throw '没有检测到 WSL。请先安装 WSL2 + Ubuntu。' }
Info ('WSL: ' + (($wsl | Select-Object -First 2) -join ' '))
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw '没有 git。' }

if (-not $Install) {
  Info '只检查，没有安装。加 -Install 才会拉仓库并执行安装命令。'
  Info ('计划目录: ' + $InstallDir)
  Info ('后端: ' + $Backend + '（auto 需要你在 WSL 里确认 nvidia-smi / ROCm 兼容）')
  exit 0
}

if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  Info '克隆声音服务仓库…'
  git clone https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice.git $InstallDir
} else { Info '目录已存在，不覆盖。' }

if ($Backend -eq 'auto') {
  if (($gpu -join ' ') -match 'NVIDIA') { $Backend = 'cuda' } else { $Backend = 'rocm' }
}
Info ('使用后端: ' + $Backend)

Info '接下来在 WSL 里执行（需要你确认 sudo/显卡驱动）：'
$cmds = @(
  'sudo apt-get update',
  'sudo apt-get install -y git ffmpeg libsndfile1 libsox-dev build-essential python3-dev',
  'cd "' + ($InstallDir -replace '\\','/') + '/server"',
  'uv python install 3.11.17',
  'feiyu_python="$(uv python find 3.11.17)"',
  'feiyu_env_root="$HOME/.local/share/feiyu-voice/' + $Backend + '"',
  '"$feiyu_python" scripts/setup_runtime.py --backend ' + $Backend + ' --engine rvc --python "$feiyu_python" --destination "$feiyu_env_root/rvc"',
  '"$feiyu_python" scripts/setup_runtime.py --backend ' + $Backend + ' --engine tts --python "$feiyu_python" --destination "$feiyu_env_root/tts"'
)
if ($WithSvs) { $cmds += '"$feiyu_python" scripts/setup_runtime.py --backend ' + $Backend + ' --engine svs --python "$feiyu_python" --destination "$feiyu_env_root/svs"' }
$cmds | ForEach-Object { Write-Host '  ' + $_ }
Info '模型下载、configs/runtime.*.local.json 和 voice_service.json 按 server/INSTALL_AGENT.md 第 3 步配置；不会自动下载大模型。'
Info '服务启动: server 目录 .venv\Scripts\python.exe -m feiyu_voice_service --config configs\voice_service.json'
Info '装好后把 baseUrl/apiKey 填到 dsh-identity 面板「语音」。'
