@echo off
rem 启动大肥鱼语音常驻服务（WSL + CUDA，加载约 20 秒）
wsl -d Ubuntu -e bash /root/dstart.sh
ping -n 3 127.0.0.1 >nul
wsl -d Ubuntu -e bash -lc "curl -s -m 3 http://127.0.0.1:9881/health"
echo.

exit /b 0
