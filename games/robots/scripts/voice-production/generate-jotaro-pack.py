"""Build p1 only from the user-approved Original B full-ICL recipe.

Only the approved challenge B is copied. Other lines reuse one original prompt.
All models are local. --phase asr/finalize never synthesize; --only bounds retries.
"""
from __future__ import annotations
import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
BASE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
BASE_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
BASE_WEIGHT_SHA = "38fc7fc51c5e776e840414b6fd443962e9411b9654888fd7913e4da643cb857c"
ASR_REVISION = "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"
RECIPE = "jotaro-original-b-icl-v1"
REFERENCE_SHA = "17bad1ef01499370b836f7a5d5761b9150d6fa23036124c095e951a54e883741"
REFERENCE_TEXT = "Ублюдок! Дио!"
COPIES = {
    "faceoff-challenge-p1": {"sha256": "b70455f4432e6b4cc56d989c0cf17734e87e21a7bf5f2440cc35cec814642544", "text": "Хватит пафоса! Покажи, на что СПОСОБЕН!", "seed": 62101, "rawDuration": 4.48, "trim": [.02, 4.48], "method": "User-approved Original B, original Jotaro full ICL"},
}
SETTINGS = dict(non_streaming_mode=True, max_new_tokens=240, temperature=.9,
    top_k=50, top_p=1., do_sample=True, repetition_penalty=1.05)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def words(text):
    return re.findall(r"[a-zа-я0-9]+", text.lower().replace("ё", "е"))


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def trim(y, sr, np, margin=.08):
    hop = round(sr * .01)
    padded = np.pad(y, (0, (-len(y)) % hop))
    rms = np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1))
    active = np.flatnonzero(rms > max(.002, float(rms.max()) * .025))
    if not len(active):
        raise ValueError("Silent generated audio")
    lo = max(0, active[0] * hop - round(margin * sr))
    hi = min(len(y), (active[-1] + 1) * hop + round(margin * sr))
    return y[lo:hi], [lo / sr, hi / sr]


def loudness(path, ffmpeg):
    result = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf8", errors="replace", check=True).stderr
    return json.loads(result[result.rfind("{"):result.rfind("}") + 1])


def encode(source, output, duration, ffmpeg):
    levels = loudness(source, ffmpeg)
    filters = "loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:" + ":".join([
        f"measured_I={levels['input_i']}", f"measured_TP={levels['input_tp']}",
        f"measured_LRA={levels['input_lra']}", f"measured_thresh={levels['input_thresh']}",
        f"offset={levels['target_offset']}"])
    filters += f",afade=t=in:st=0:d=0.006,afade=t=out:st={max(0, duration-.012):.5f}:d=0.012"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-af", filters, "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", str(output)], check=True)


def analyze(path, sf, np, ffmpeg):
    y, sr = sf.read(path, dtype="float32")
    if y.ndim != 1 or sr != 24000 or not np.isfinite(y).all() or np.max(np.abs(y)) >= .99:
        raise ValueError("Invalid MP3 PCM: " + path.name)
    duration = len(y) / sr
    if not .2 < duration < 12:
        raise ValueError("Unexpected MP3 duration: " + path.name)
    _, active = trim(y, sr, np, margin=0)
    levels = loudness(path, ffmpeg)
    return dict(duration=duration, sampleRate=sr, channels=1, peak=float(np.abs(y).max()),
        clippedFraction=float(np.mean(np.abs(y) >= .999)), leadingSilence=active[0],
        trailingSilence=max(0, duration-active[1]), integratedLUFS=float(levels["input_i"]),
        truePeakDBFS=float(levels["input_tp"]), bytes=path.stat().st_size, sha256=sha(path))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--asr-model", type=Path, required=True)
    p.add_argument("--work", type=Path, required=True, help="External raw WAV and failed-take archive")
    p.add_argument("--reference", type=Path, default=ROOT / "public/assets/voices/jotaro-dio.mp3")
    p.add_argument("--challenge-pilot", type=Path, default=ROOT / "public/assets/voices/spoken-v2/faceoff-challenge-p1.mp3")
    p.add_argument("--script", type=Path, default=ROOT / "scripts/voice-production/spoken-script.json")
    p.add_argument("--output", type=Path, default=ROOT / "public/assets/voices/spoken-v2")
    p.add_argument("--report", type=Path, default=ROOT / "scripts/voice-production/jotaro-pack-analysis.json")
    p.add_argument("--catalog", type=Path, default=ROOT / "shared/generated-jotaro-voice-clips.js")
    p.add_argument("--phase", choices=["all", "synth", "asr", "finalize"], default="all")
    p.add_argument("--only", help="Comma-separated exact p1 IDs, for bounded failed-take retries")
    p.add_argument("--seed", type=int, default=62101)
    p.add_argument("--asr-device", choices=["cuda", "cpu"], default="cuda")
    args = p.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import soundfile as sf
    import torch
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    args.work.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    lines = [u for u in json.loads(args.script.read_text(encoding="utf8"))["utterances"] if u["speaker"] == "p1"]
    assert len(lines) == 28 and len({u["id"] for u in lines}) == 28
    selected = set(args.only.split(",")) if args.only else {u["id"] for u in lines}
    if selected - {u["id"] for u in lines} or (args.seed != 62101 and not args.only):
        raise ValueError("Retry IDs must be explicit existing p1 lines")
    for line in lines:
        if not isinstance(line.get("synthesisText"), str) or words(line["synthesisText"]) != words(line["text"]):
            raise ValueError("synthesisText may change only punctuation/case: " + line["id"])
    copy_paths = {"faceoff-challenge-p1": args.challenge_pilot}
    if sha(args.reference) != REFERENCE_SHA:
        raise ValueError("User-selected original Jotaro reference has changed")
    if sha(args.model / "model.safetensors") != BASE_WEIGHT_SHA:
        raise ValueError("Base model weights differ from the measured production snapshot")
    for cid, source in copy_paths.items():
        copied_line = next(u for u in lines if u["id"] == cid)
        if sha(source) != COPIES[cid]["sha256"] or copied_line["text"] != COPIES[cid]["text"] or copied_line["synthesisText"] != COPIES[cid]["text"]:
            raise ValueError("Approved pilot bytes/text changed: " + cid)
    previous = json.loads(args.report.read_text(encoding="utf8")) if args.report.exists() else None
    if previous and previous.get("recipe") != RECIPE:
        if args.only or args.phase != "all":
            raise ValueError("A changed reference recipe requires a complete new pack")
        shutil.copyfile(args.report, args.work / ("previous-report-" + sha(args.report)[:12] + ".json"))
        for row in previous.get("clips", []):
            old = args.output / (row["id"] + ".mp3")
            if old.exists():
                shutil.copyfile(old, args.work / (row["id"] + "-superseded-" + sha(old)[:12] + ".mp3"))
        previous = None
    report = previous if previous else {
        "recipe": RECIPE,
        "model": BASE_MODEL, "revision": BASE_REVISION, "license": "Apache-2.0",
        "generationSettings": SETTINGS, "dtype": "bfloat16", "attention": "sdpa",
        "identity": "Full ICL from the user's original Jotaro recording, one shared prompt. No designed voice.",
        "reference": {"source": "public/assets/voices/jotaro-dio.mp3", "originalName": "Джот - Ублюдок, ДЫО.mp3", "sha256": REFERENCE_SHA, "refText": REFERENCE_TEXT, "xVectorOnly": False, "range": [0, 4.284979166666667], "duration": 4.284979166666667, "reusedPrompt": True, "processing": "Full 48 kHz source; stereo mean then PCM16 roundtrip, exactly as approved Original B"},
        "copiedPilots": COPIES, "approvedPilotId": "faceoff-challenge-p1", "userListeningApproved": False,
        "auditoryReview": "User approved only Original B ('Б — усиленные акценты ... хорош!'). Its challenge MP3 is copied byte-for-byte. Other27 receive technical/ASR checks, not a claim of listening approval.",
        "processing": {"tempo": 1, "pitchShift": 0, "silenceMargin": .08, "normalization": "two-pass -18 LUFS / -1.5 dBTP / LRA 11 with 6/12 ms edge fades, exactly as Original B", "mp3": "mono 24 kHz 128 kbit/s"},
        "runtime": {"python": __import__("sys").version, "packages": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "qwen-tts", "soundfile", "numpy", "librosa", "imageio-ffmpeg"]}},
        "clips": [], "attemptHistory": []}
    report["generatorSha256"] = hashlib.sha256(Path(__file__).read_text(encoding="utf8").encode("utf8")).hexdigest()
    report["generatorHashEncoding"] = "UTF-8 with LF line endings"
    report["baseWeightSha256"] = BASE_WEIGHT_SHA
    rows = {r["id"]: r for r in report["clips"]}
    def save():
        report["clips"] = [rows[u["id"]] for u in lines if u["id"] in rows]
        dump(args.report, report)
    if args.phase in ["all", "synth"]:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA required; CPU TTS must not start silently")
        from qwen_tts import Qwen3TTSModel
        model = Qwen3TTSModel.from_pretrained(str(args.model), device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        ref, sr = sf.read(args.reference, dtype="float32")
        assert sr == 48000 and ref.ndim == 2
        ref = ref.mean(axis=1)
        ref_path = args.work / "jotaro-original-reference.wav"
        sf.write(ref_path, ref, sr, subtype="PCM_16")
        ref, sr = sf.read(ref_path, dtype="float32")
        report["reference"]["wavSha256"] = sha(ref_path)
        prompt = model.create_voice_clone_prompt(ref_audio=(ref, sr), ref_text=REFERENCE_TEXT, x_vector_only_mode=False)
        for line in lines:
            cid = line["id"]
            if cid not in selected:
                continue
            print("SYNTH", cid, flush=True)
            output = args.output / (cid + ".mp3")
            if cid in rows:
                report["attemptHistory"].append(rows[cid])
                if output.exists():
                    shutil.copyfile(output, args.work / (cid + "-previous-" + rows[cid]["sha256"][:12] + ".mp3"))
            row = {"id": cid, "speaker": "p1", "text": line["text"], "synthesisText": line["synthesisText"], "seed": args.seed,
                "source": "Base full-ICL from one original Jotaro prompt", "scriptMaxDuration": line["maxDuration"], "tempo": 1, "userListeningApproved": False}
            if cid in COPIES:
                source = copy_paths[cid]
                if source.resolve() != output.resolve():
                    shutil.copyfile(source, output)
                row.update(source="approved-pilot-byte-copy", seed=COPIES[cid]["seed"], rawDuration=COPIES[cid]["rawDuration"], trim=COPIES[cid]["trim"], userListeningApproved=True)
            else:
                torch.manual_seed(args.seed)
                started = time.perf_counter()
                with torch.inference_mode():
                    waves, sr = model.generate_voice_clone(text=line["synthesisText"], language="Russian", voice_clone_prompt=prompt, **SETTINGS)
                raw = np.asarray(waves[0], dtype=np.float32)
                if not np.isfinite(raw).all() or not .2 < len(raw)/sr < 12 or np.abs(raw).max() >= .999:
                    raise ValueError("Invalid raw audio: " + cid)
                rawpath = args.work / f"{cid}-seed{args.seed}-raw.wav"
                sf.write(rawpath, raw, sr, subtype="FLOAT")
                y, limits = trim(raw, sr, np)
                wav = args.work / f"{cid}-seed{args.seed}.wav"
                sf.write(wav, y, sr, subtype="FLOAT")
                encode(wav, output, len(y)/sr, ffmpeg)
                row.update(rawDuration=len(raw)/sr, trim=limits, generationSeconds=round(time.perf_counter()-started, 3), rawWav=rawpath.name, rawSha256=sha(rawpath))
            row.update(analyze(output, sf, np, ffmpeg))
            rows[cid] = row
            save()
            print(json.dumps({"id": cid, "duration": row["duration"], "seed": row["seed"]}), flush=True)
        report["maxTtsCudaAllocatedGB"] = torch.cuda.max_memory_allocated()/1e9
        del model, prompt
        gc.collect()
        torch.cuda.empty_cache()
        save()
        print("TTS_MODEL_RELEASED", flush=True)
    if args.phase in ["all", "asr"]:
        import librosa
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
        dtype = torch.float16 if args.asr_device == "cuda" else torch.float32
        asr = AutoModelForSpeechSeq2Seq.from_pretrained(str(args.asr_model), dtype=dtype, low_cpu_mem_usage=True, attn_implementation="sdpa").to(args.asr_device)
        processor = AutoProcessor.from_pretrained(str(args.asr_model))
        transcribe = pipeline("automatic-speech-recognition", model=asr, tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor, dtype=dtype, device="cuda:0" if args.asr_device == "cuda" else "cpu")
        report["asr"] = {"model": "openai/whisper-large-v3-turbo", "revision": ASR_REVISION, "device": args.asr_device, "language": "ru", "numBeams": 5, "targetTextPrompt": False, "comparison": "Exact word sequence ignoring punctuation, case and yo/e only"}
        for line in lines:
            cid = line["id"]
            if cid not in selected:
                continue
            row = rows[cid]
            y, sr = sf.read(args.output / (cid + ".mp3"), dtype="float32")
            wave = librosa.resample(y, orig_sr=sr, target_sr=16000)
            result = transcribe({"raw": wave, "sampling_rate": 16000}, generate_kwargs={"language": "ru", "task": "transcribe", "num_beams": 5, "condition_on_prev_tokens": False})
            row["asrText"] = result["text"].strip()
            target, actual = words(row["text"]), words(row["asrText"])
            row["exactWordMatch"] = target == actual
            row["unexpectedReferenceWords"] = [w for w in words(REFERENCE_TEXT) if w in actual and w not in target]
            row["technicalPass"] = row["clippedFraction"] == 0 and row["leadingSilence"] <= .2 and row["trailingSilence"] <= .2 and row["truePeakDBFS"] < -1
            row["passed"] = row["exactWordMatch"] and not row["unexpectedReferenceWords"] and row["technicalPass"]
            row["asrAcceptance"] = "exact-word-sequence" if row["passed"] else "failed"
            save()
            print(json.dumps({"id": cid, "asr": row["asrText"], "pass": row["passed"]}, ensure_ascii=True), flush=True)
        del asr, processor, transcribe
        gc.collect()
        torch.cuda.empty_cache()
        print("ASR_MODEL_RELEASED", flush=True)
    if args.phase in ["all", "asr", "finalize"]:
        failures = [u["id"] for u in lines if not rows.get(u["id"], {}).get("passed")]
        report["failedOrMissing"] = failures
        save()
        if failures:
            print("TARGETED_RETRY_REQUIRED " + ",".join(failures), flush=True)
            raise SystemExit(2)
        for line in lines:
            row = rows[line["id"]]
            if row["text"] != line["text"] or row["synthesisText"] != line["synthesisText"] or sha(args.output / (line["id"] + ".mp3")) != row["sha256"]:
                raise ValueError("Stale script or metrics: " + line["id"])
        catalog = {u["id"]: {"url": "/assets/voices/spoken-v2/" + u["id"] + ".mp3", "text": u["text"], "duration": rows[u["id"]]["duration"], "speaker": "p1"} for u in lines}
        args.catalog.write_text("// Original Jotaro full-ICL pack using approved B; see docs/JOTARO-SPOKEN-PACK.md.\nexport const GENERATED_JOTARO_VOICE_CLIPS = Object.freeze(" + json.dumps(catalog, ensure_ascii=False, indent=2) + ");\n", encoding="utf8")
        print("CATALOG_COMPLETE 28", flush=True)


if __name__ == "__main__":
    main()
