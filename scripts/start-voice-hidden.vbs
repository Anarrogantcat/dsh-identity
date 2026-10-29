Set sh = CreateObject("WScript.Shell")
sh.Run "wsl.exe -d Ubuntu -e bash /root/start-feiyu-service.sh", 0, False

