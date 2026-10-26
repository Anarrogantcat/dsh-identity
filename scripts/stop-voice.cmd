@echo off
wsl -d Ubuntu -e bash -lc "pkill -f tts_daemon.py"
echo stopped
