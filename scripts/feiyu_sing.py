import argparse, os, struct, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, "/root/svs_deps")
ROOT = Path("/root/soulx-singer-src")
PYBIN = "/root/.local/share/feiyu-voice/cuda/tts/venv/bin/python"
ENV = dict(os.environ, PYTHONPATH=str(ROOT) + ":/root/svs_deps:/root/rvc_deps")
OUT = Path("/mnt/d/AI/DeepSeek Harness Workspace/dsh-qqbot-refine/_demo")
OUT.mkdir(parents=True, exist_ok=True)

def write_midi(path, lyrics, bpm=96):
    import mido
    melody=[60,62,64,65,67,65,64,62,60,64,67,72,71,67,64,60]
    chars=[c for c in lyrics if c.strip()]
    if not chars: raise SystemExit("empty lyrics")
    mid=mido.MidiFile(ticks_per_beat=480)
    tr=mido.MidiTrack(); mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=int(60_000_000/bpm), time=0))
    for i,ch in enumerate(chars):
        n=melody[i%len(melody)]
        tr.append(mido.MetaMessage("lyrics", text=ch.encode("utf8").decode("latin1"), time=0))
        tr.append(mido.Message("note_on", note=n, velocity=90, time=0))
        tr.append(mido.Message("note_off", note=n, velocity=0, time=480))
    mid.save(path)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--lyrics", default="海风轻轻吹过来今天也要吃得饱饱的")
    a=ap.parse_args()
    work=ROOT/"work"; work.mkdir(exist_ok=True)
    midi=work/"score.mid"; meta=work/"score.json"
    write_midi(midi, a.lyrics)
    r=subprocess.run([PYBIN,"-m","preprocess.tools.midi_parser","--midi2meta","--midi",str(midi),"--meta",str(meta),"--language","Mandarin"],cwd=ROOT,env=ENV)
    if r.returncode: raise SystemExit("midi2meta failed")
    out=work/("svs_%d"%int(time.time()))
    r=subprocess.run([PYBIN,"-m","cli.inference","--device","cuda","--model_path","pretrained_models/SoulX-Singer/model.pt","--config","soulxsinger/config/soulxsinger.yaml","--prompt_wav_path","example/audio/zh_prompt.mp3","--prompt_metadata_path","example/audio/zh_prompt.json","--target_metadata_path",str(meta),"--phoneset_path","soulxsinger/utils/phoneme/phone_set.json","--save_dir",str(out),"--auto_shift","--pitch_shift","0","--fp16"],cwd=ROOT,env=ENV)
    if r.returncode: raise SystemExit("svs failed")
    svs=out/"generated.wav"
    final=OUT/f"sing-{int(time.time())}.wav"
    code=f"""
import sys
sys.path.insert(0,"/root/.local/share/feiyu-voice/cuda/rvc/source")
sys.path.insert(0,"/root/rvc_deps"); sys.path.insert(0,"/root/svs_deps")
from rvc.infer.infer import VoiceConverter
vc=VoiceConverter()
vc.convert_audio(audio_input_path={str(svs)!r}, audio_output_path={str(final)!r}, model_path="/root/.local/share/feiyu-voice/repo/server/models/FeiyuVoice-RVC/FeiyuVoice-RVC-v1.pth", index_path="/root/.local/share/feiyu-voice/repo/server/models/FeiyuVoice-RVC/FeiyuVoice-RVC-v1.index", pitch=0, f0_method="rmvpe", index_rate=0.3, protect=0.33)
"""
    r=subprocess.run([PYBIN,"-c",code],cwd="/root/.local/share/feiyu-voice/cuda/rvc/source",env=ENV)
    if r.returncode: raise SystemExit("rvc failed")
    print(final)

main()
