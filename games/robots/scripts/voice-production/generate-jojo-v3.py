"""Regenerate every spoken line from the two approved reference recipes.

No copied dialogue, system TTS, pitch shift, tempo adjustment or network API.
Models and raw WAVs stay outside the repo; compact MP3s are the runtime assets.
"""
from __future__ import annotations
import argparse
import gc
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("voice_metrics", Path(__file__).with_name("generate-jotaro-pack.py"))
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)
REFERENCES = {
    "p1": {"file": "jotaro-dio.mp3", "range": None, "text": "Ублюдок! Дио!", "seed": 62101,
        "sha256": "17bad1ef01499370b836f7a5d5761b9150d6fa23036124c095e951a54e883741",
        "pilot": "faceoff-challenge-p1", "pilotSha256": "b70455f4432e6b4cc56d989c0cf17734e87e21a7bf5f2440cc35cec814642544"},
    "p2": {"file": "greeting.mp3", "range": [7.70, 11.32], "text": "Что ты мне сделаешь, а, Джотаро?", "seed": 62202,
        "sha256": "780ac5cb344f3a1c9cbe514b718b183a78bac98315de0047f4726cab66bb3361",
        "pilot": "faceoff-mode-p2", "pilotSha256": "639de7c08eddd6c2aff517a6d0edc4f316e1a47c697c58e87f0137d7e43a1ed1"},
}

def encode(wav, mp3, duration, ffmpeg):
    levels = metrics.loudness(wav, ffmpeg)
    filters = "loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:" + ":".join([
        f"measured_I={levels['input_i']}", f"measured_TP={levels['input_tp']}",
        f"measured_LRA={levels['input_lra']}", f"measured_thresh={levels['input_thresh']}", f"offset={levels['target_offset']}"])
    filters += f",afade=t=in:st=0:d=0.006,afade=t=out:st={max(0, duration-.012):.5f}:d=0.012"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
        "-af", filters, "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", str(mp3)], check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--asr-model", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--phase", choices=["all", "synth", "asr", "finalize"], default="all")
    parser.add_argument("--only", help="Explicit IDs for a bounded retry or pilot")
    parser.add_argument("--seed", type=int, help="Retry seed; requires --only")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import soundfile as sf
    import torch
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    args.work.mkdir(parents=True, exist_ok=True)
    output = ROOT / "public/assets/voices/spoken-v3"
    output.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "scripts/voice-production/jojo-v3-analysis.json"
    script_path = ROOT / "scripts/voice-production/spoken-script.json"
    lines = json.loads(script_path.read_text(encoding="utf8"))["utterances"]
    assert len(lines) == 57 and len({line["id"] for line in lines}) == 57
    selected = set(args.only.split(",")) if args.only else {line["id"] for line in lines}
    assert selected <= {line["id"] for line in lines}
    if args.seed is not None and not args.only:
        raise ValueError("A different seed requires bounded --only retry IDs")
    for line in lines:
        if metrics.words(line.get("synthesisText", "")) != metrics.words(line["text"]):
            raise ValueError("synthesisText may only change emphasis/punctuation: " + line["id"])
    if metrics.sha(args.model / "model.safetensors") != metrics.BASE_WEIGHT_SHA:
        raise ValueError("Unexpected local model snapshot")
    report = json.loads(report_path.read_text(encoding="utf8")) if report_path.exists() else {
        "recipe": "jojo-v3-full-rerecording", "model": metrics.BASE_MODEL, "revision": metrics.BASE_REVISION,
        "references": REFERENCES, "generationSettings": metrics.SETTINGS,
        "processing": {"tempo": 1, "pitchShift": 0, "mp3": "24 kHz mono 64 kbit/s", "normalization": "-18 LUFS / -1.5 dBTP / LRA11", "fadesMs": [6, 12]},
        "userListeningApproved": False, "copiedRecordings": [],
        "reviewScope": "Reference recipes were selected by the user; new dialogue is entirely generated. Signal/ASR/embedding checks do not constitute human listening approval.",
        "clips": [], "attemptHistory": []}
    report["generatorSha256"] = hashlib.sha256(Path(__file__).read_text(encoding="utf8").encode()).hexdigest()
    rows = {row["id"]: row for row in report["clips"]}
    def save():
        report["clips"] = [rows[line["id"]] for line in lines if line["id"] in rows]
        metrics.dump(report_path, report)
    if args.phase in ["all", "synth"]:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA required for this offline production recipe")
        from qwen_tts import Qwen3TTSModel
        model = Qwen3TTSModel.from_pretrained(str(args.model), device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        prompts, pilot_embeddings, reference_embeddings = {}, {}, {}
        def embedding(audio, sr):
            prompt = model.create_voice_clone_prompt(ref_audio=(audio, sr), x_vector_only_mode=True)
            vector = prompt[0].ref_spk_embedding.float()
            return vector / vector.norm()
        for seat, config in REFERENCES.items():
            path = ROOT / "public/assets/voices" / config["file"]
            assert metrics.sha(path) == config["sha256"]
            ref, sr = sf.read(path, dtype="float32")
            if ref.ndim == 2:
                ref = ref.mean(axis=1)
            if config["range"]:
                ref = ref[round(config["range"][0]*sr):round(config["range"][1]*sr)]
            ref_path = args.work / (seat + "-reference.wav")
            sf.write(ref_path, ref, sr, subtype="PCM_16")
            ref, sr = sf.read(ref_path, dtype="float32")
            prompts[seat] = model.create_voice_clone_prompt(ref_audio=(ref, sr), ref_text=config["text"], x_vector_only_mode=False)
            vector = prompts[seat][0].ref_spk_embedding.float()
            reference_embeddings[seat] = vector / vector.norm()
            pilot = ROOT / "public/assets/voices/spoken-v2" / (config["pilot"] + ".mp3")
            assert metrics.sha(pilot) == config["pilotSha256"]
            y, pilot_sr = sf.read(pilot, dtype="float32")
            pilot_embeddings[seat] = embedding(y, pilot_sr)
        for line in lines:
            cid, seat = line["id"], line["speaker"]
            if cid not in selected:
                continue
            seed = args.seed if args.seed is not None else REFERENCES[seat]["seed"]
            if cid in rows:
                report["attemptHistory"].append(rows[cid])
                old = output / (cid + ".mp3")
                if old.exists():
                    shutil.copyfile(old, args.work / (cid + "-rejected-" + metrics.sha(old)[:12] + ".mp3"))
            torch.manual_seed(seed)
            print("SYNTH " + cid, flush=True)
            started = time.perf_counter()
            with torch.inference_mode():
                waves, sr = model.generate_voice_clone(text=line["synthesisText"], language="Russian", voice_clone_prompt=prompts[seat], **metrics.SETTINGS)
            raw = np.asarray(waves[0], dtype=np.float32)
            if not np.isfinite(raw).all() or not .2 < len(raw)/sr < 12 or np.abs(raw).max() >= .999:
                raise ValueError("Invalid generated signal: " + cid)
            raw_path = args.work / f"{cid}-seed{seed}-raw.wav"
            sf.write(raw_path, raw, sr, subtype="FLOAT")
            trimmed, limits = metrics.trim(raw, sr, np)
            wav = args.work / f"{cid}-seed{seed}.wav"
            sf.write(wav, trimmed, sr, subtype="FLOAT")
            mp3 = output / (cid + ".mp3")
            encode(wav, mp3, len(trimmed)/sr, ffmpeg)
            encoded, encoded_sr = sf.read(mp3, dtype="float32")
            vector = embedding(encoded, encoded_sr)
            row = {"id": cid, "speaker": seat, "text": line["text"], "synthesisText": line["synthesisText"], "seed": seed,
                "source": "new Base full ICL synthesis", "copied": False, "userListeningApproved": False,
                "rawDuration": len(raw)/sr, "rawSha256": metrics.sha(raw_path), "rawWav": raw_path.name, "trim": limits,
                "generationSeconds": round(time.perf_counter()-started, 3),
                "pilotCosine": {s: round(float(torch.dot(vector, v)), 5) for s,v in pilot_embeddings.items()},
                "referenceCosine": {s: round(float(torch.dot(vector, v)), 5) for s,v in reference_embeddings.items()},
                **metrics.analyze(mp3, sf, np, ffmpeg)}
            rows[cid] = row
            save()
            print(json.dumps({"id": cid, "duration": row["duration"], "pilotCosine": row["pilotCosine"]}), flush=True)
        report["maxTtsCudaAllocatedGB"] = torch.cuda.max_memory_allocated()/1e9
        del model, prompts, pilot_embeddings, reference_embeddings
        gc.collect()
        torch.cuda.empty_cache()
        save()
    if args.phase in ["all", "asr"]:
        import librosa
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
        model = AutoModelForSpeechSeq2Seq.from_pretrained(str(args.asr_model), dtype=torch.float16, low_cpu_mem_usage=True, attn_implementation="sdpa").to("cuda")
        processor = AutoProcessor.from_pretrained(str(args.asr_model))
        transcribe = pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor, dtype=torch.float16, device="cuda:0")
        report["asr"] = {"model": "openai/whisper-large-v3-turbo", "revision": metrics.ASR_REVISION, "numBeams": 5, "targetTextPrompt": False}
        for line in lines:
            cid = line["id"]
            if cid not in selected:
                continue
            row = rows[cid]
            y, sr = sf.read(output / (cid + ".mp3"), dtype="float32")
            wave = librosa.resample(y, orig_sr=sr, target_sr=16000)
            result = transcribe({"raw": wave, "sampling_rate": 16000}, generate_kwargs={"language":"ru", "task":"transcribe", "num_beams":5, "condition_on_prev_tokens":False})
            row["asrText"] = result["text"].strip()
            row["exactWordMatch"] = metrics.words(row["text"]) == metrics.words(row["asrText"])
            row["technicalPass"] = row["clippedFraction"] == 0 and row["leadingSilence"] <= .2 and row["trailingSilence"] <= .2 and row["truePeakDBFS"] < -1
            row["passed"] = row["exactWordMatch"] and row["technicalPass"]
            save()
            print(json.dumps({"id":cid,"asr":row["asrText"],"pass":row["passed"]}, ensure_ascii=True),flush=True)
        del model, processor, transcribe
        gc.collect()
        torch.cuda.empty_cache()
    if args.phase in ["all", "asr", "finalize"]:
        report["failedOrMissing"] = [line["id"] for line in lines if not rows.get(line["id"], {}).get("passed")]
        save()
        if report.get("productionAcceptance", {}).get("status") == "not-approved-do-not-publish":
            print("CATALOG_BLOCKED: this performance was explicitly rejected; technical retries do not change that decision.", flush=True)
            raise SystemExit(3)
        if report["failedOrMissing"]:
            print("TARGETED_RETRY_REQUIRED " + ",".join(report["failedOrMissing"]),flush=True)
            raise SystemExit(2)
        for line in lines:
            row = rows[line["id"]]
            if row["text"] != line["text"] or row["synthesisText"] != line["synthesisText"] or metrics.sha(output / (line["id"]+".mp3")) != row["sha256"]:
                raise ValueError("Stale recording: " + line["id"])
        for seat, actor in [("p1","jotaro"),("p2","dio")]:
            catalog = {line["id"]:{"url":"/assets/voices/spoken-v3/"+line["id"]+".mp3","text":line["text"],"speaker":seat,"duration":rows[line["id"]]["duration"]} for line in lines if line["speaker"] == seat}
            (ROOT / f"shared/generated-{actor}-voice-clips.js").write_text("// Fully rewritten JoJo dialogue, compact recordings; see docs/JOJO-AUDIO-V3.md.\nexport const GENERATED_"+actor.upper()+"_VOICE_CLIPS = Object.freeze("+json.dumps(catalog,ensure_ascii=False,indent=2)+");\n",encoding="utf8")
        print("CATALOG_COMPLETE 57", flush=True)

if __name__ == "__main__":
    main()
