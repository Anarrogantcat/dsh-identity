import argparse, os, struct, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, "/root/svs_deps")
ROOT = Path("/root/soulx-singer-src")
PYBIN = "/root/.local/share/feiyu-voice/cuda/tts/venv/bin/python"
ENV = dict(os.environ, PYTHONPATH=str(ROOT) + ":/root/svs_deps:/root/rvc_deps")
OUT = Path("/mnt/d/AI/DeepSeek Harness Workspace/dsh-qqbot-refine/_demo")
OUT.mkdir(parents=True, exist_ok=True)

def write_midi(path, lyrics, bpm=100):
    import mido
    # 公有领域旋律模板（小星星），配原创词；一句 7 个音，句尾拉长
    melody = [60,60,67,67,69,69,67, 65,65,64,64,62,62,60]
    phrases = [x for x in lyrics.replace("，"," ").replace("。"," ").replace("、"," ").split() if x.strip()]
    chars = [c for ph in phrases for c in ph if c.strip()]
    if not chars: raise SystemExit("empty lyrics")
    mid = mido.MidiFile(ticks_per_beat=480)
    tr = mido.MidiTrack(); mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=int(60_000_000 / bpm), time=0))
    for i, ch in enumerate(chars):
        n = melody[i % len(melody)]
        dur = 960 if (i % 7 == 6) else 480
        tr.append(mido.MetaMessage("lyrics", text=ch.encode("utf8").decode("latin1"), time=0))
        tr.append(mido.Message("note_on", note=n, velocity=88, time=0))
        tr.append(mido.Message("note_off", note=n, velocity=0, time=dur))
    mid.save(path)


def add_f0_and_rest(meta_path):
    import json, math
    data=json.load(open(meta_path))
    for seg in data:
        durs=[float(x) for x in seg["duration"].split()]
        pitches=[int(float(x)) for x in seg["note_pitch"].split()]
        types=[int(float(x)) for x in seg["note_type"].split()]
        texts=seg["text"].split(); phones=seg["phoneme"].split()
        # 头尾气口
        durs=[0.5]+durs+[0.5]; pitches=[0]+pitches+[0]; types=[1]+types+[1]
        texts=["<SP>"]+texts+["<SP>"]; phones=["<SP>"]+phones+["<SP>"]
        f0=[]
        for d,p in zip(durs,pitches):
            n=max(1,round(d/0.02))
            hz=0.0 if p<=0 else 440.0*(2**((p-69)/12))
            f0.extend([round(hz,1)]*n)
        seg["duration"]=" ".join(str(round(x,2)) for x in durs)
        seg["note_pitch"]=" ".join(str(x) for x in pitches)
        seg["note_type"]=" ".join(str(x) for x in types)
        seg["text"]=" ".join(texts); seg["phoneme"]=" ".join(phones)
        seg["f0"]=" ".join(str(x) for x in f0)
        seg["time"]=[0, int(sum(durs)*1000)]
    json.dump(data, open(meta_path,"w"), ensure_ascii=False)


def write_midi_from_template(path, lyrics, template):
    import json, mido
    seg=json.load(open(template))[0]
    texts=seg["text"].split(); pitches=[int(float(x)) for x in seg["note_pitch"].split()]
    durs=[float(x) for x in seg["duration"].split()]; types=[int(float(x)) for x in seg["note_type"].split()]
    notes=[(p,d) for t,p,d,ty in zip(texts,pitches,durs,types) if t!="<SP>"]
    chars=[c for c in lyrics if c.strip()]
    if len(chars)<len(notes): notes=notes[:len(chars)]
    elif len(chars)>len(notes): chars=chars[:len(notes)]
    mid=mido.MidiFile(ticks_per_beat=480); tr=mido.MidiTrack(); mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))  # 120 BPM
    for ch,(n,d) in zip(chars,notes):
        ticks=max(60,round(d*960))
        tr.append(mido.MetaMessage("lyrics", text=ch.encode("utf8").decode("latin1"), time=0))
        tr.append(mido.Message("note_on", note=n, velocity=88, time=0))
        tr.append(mido.Message("note_off", note=n, velocity=0, time=ticks))
    mid.save(path)


def use_template_f0(meta_path, template):
    import json
    tpl=json.load(open(template))[0]
    tpl_f0=[float(x) for x in tpl["f0"].split()]
    data=json.load(open(meta_path))
    for seg in data:
        durs=[float(x) for x in seg["duration"].split()]
        frames=max(1, round(sum(durs)/0.02))
        seg["f0"]=" ".join(str(x) for x in tpl_f0[:frames])
        seg["time"]=[0, int(sum(durs)*1000)]
    json.dump(data, open(meta_path,"w"), ensure_ascii=False)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--lyrics", default="海风轻轻吹过来今天也要吃得饱饱的")
    ap.add_argument("--template", default="")
    a=ap.parse_args()
    work=ROOT/"work"; work.mkdir(exist_ok=True)
    midi=work/"score.mid"; meta=work/"score.json"
    if a.template: write_midi_from_template(midi, a.lyrics, a.template.strip())
    else: write_midi(midi, a.lyrics)
    r=subprocess.run([PYBIN,"-m","preprocess.tools.midi_parser","--midi2meta","--midi",str(midi),"--meta",str(meta),"--language","Mandarin"],cwd=ROOT,env=ENV)
    if r.returncode: raise SystemExit("midi2meta failed")
    if a.template: use_template_f0(meta, a.template.strip())
    else: add_f0_and_rest(meta)
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
