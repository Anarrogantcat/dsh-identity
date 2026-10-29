Set sh = CreateObject("WScript.Shell")
cmd = "wsl.exe -d Ubuntu -e bash -lc " & Chr(34) & "export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True FEIYU_TTS_IDLE_SEC=600; exec /root/.local/share/feiyu-voice/cuda/tts/venv/bin/python /root/tts_daemon.py 9881" & Chr(34)
sh.Run cmd, 0, False
