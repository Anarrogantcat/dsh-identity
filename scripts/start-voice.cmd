@echo off
rem 启动大肥鱼语音常驻服务（WSL + CUDA）。前台跑在最小化窗口里，空闲 10 分钟自己退出。
start "feiyu-voice" /min wsl -d Ubuntu -e bash -lc "exec /root/.local/share/feiyu-voice/cuda/tts/venv/bin/python /root/tts_daemon.py 9881"
exit /b 0
