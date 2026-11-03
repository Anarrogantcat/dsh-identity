# 隐藏启动大肥鱼语音服务（WSL + CUDA）
$ErrorActionPreference = 'SilentlyContinue'
$cmd = 'export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True FEIYU_TTS_IDLE_SEC=600; exec /root/.local/share/feiyu-voice/cuda/tts/venv/bin/python /root/tts_daemon.py 9881'
Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d','Ubuntu','-e','bash','-lc',$cmd) -WindowStyle Hidden
