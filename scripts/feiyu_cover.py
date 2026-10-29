import os, subprocess, sys, time
from pathlib import Path
ROOT=Path("/root/soulx-singer-src"); PY="/root/.local/share/feiyu-voice/cuda/tts/venv/bin/python"
ENV=dict(os.environ, PYTHONPATH="/root/cover_deps:/root/rvc_deps:/root/svs_deps")
OUT=Path("/mnt/d/AI/DeepSeek Harness Workspace/dsh-qqbot-refine/_demo"); OUT.mkdir(parents=True,exist_ok=True)
song=Path(sys.argv[1])
work=ROOT/"work"/("cover_%d"%int(time.time()))
r=subprocess.run([PY,"-m","demucs.separate","--two-stems=vocals","-n","htdemucs","-o",str(work),str(song)],cwd=ROOT,env=ENV)
if r.returncode: raise SystemExit("demucs failed")
stem=work/"htdemucs"/song.stem
voc=stem/"vocals.wav"; inst=stem/"no_vocals.wav"
if not voc.exists() or not inst.exists(): raise SystemExit("stems missing")
feiyu=work/"feiyu_vocal.wav"
code=f"""
import sys
sys.path.insert(0,"/root/.local/share/feiyu-voice/cuda/rvc/source")
sys.path.insert(0,"/root/rvc_deps"); sys.path.insert(0,"/root/svs_deps")
from rvc.infer.infer import VoiceConverter
vc=VoiceConverter()
vc.convert_audio(audio_input_path={str(voc)!r}, audio_output_path={str(feiyu)!r}, model_path="/root/.local/share/feiyu-voice/repo/server/models/FeiyuVoice-RVC/FeiyuVoice-RVC-v1.pth", index_path="/root/.local/share/feiyu-voice/repo/server/models/FeiyuVoice-RVC/FeiyuVoice-RVC-v1.index", pitch=0, f0_method="rmvpe", index_rate=0.3, protect=0.33)
"""
r=subprocess.run([PY,"-c",code],cwd="/root/.local/share/feiyu-voice/cuda/rvc/source",env=ENV)
if r.returncode: raise SystemExit("rvc failed")
if "--vocal-only" in sys.argv:
    final=OUT/("feiyu-clean-%d.mp3"%int(time.time()))
    r=subprocess.run(["ffmpeg","-y","-i",str(feiyu),"-codec:a","libmp3lame","-q:a","4",str(final)],env=ENV)
    if r.returncode: raise SystemExit("vocal export failed")
    print(final); raise SystemExit(0)
final=OUT/("feiyu-cover-%d.mp3"%int(time.time()))
r=subprocess.run(["ffmpeg","-y","-i",str(inst),"-i",str(feiyu),"-filter_complex","[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11","-ar","44100","-b:a","192k",str(final)],env=ENV)
if r.returncode: raise SystemExit("mix failed")
print(final)
