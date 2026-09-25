"""Build only p2's spoken-v2 pack using the user-approved full-ICL Dio pilot.

No network or runtime timeline changes. The accepted mode recording is copied,
never synthesized. Other takes use the same single-actor reference and settings.
Run --phase all once; use --only ID,... --seed N for a targeted failed take.
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
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
ASR_REVISION = "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"
REFERENCE_TEXT = "Что ты мне сделаешь, а, Джотаро?"
REFERENCE_RANGE = (7.70, 11.32)
REFERENCE_HASH = "780ac5cb344f3a1c9cbe514b718b183a78bac98315de0047f4726cab66bb3361"
ACCEPTED_ID = "faceoff-mode-p2"
ACCEPTED_TEXT = "Твой гарантийный талон уже мёртв!"
ACCEPTED_HASH = "639de7c08eddd6c2aff517a6d0edc4f316e1a47c697c58e87f0137d7e43a1ed1"
SETTINGS = dict(non_streaming_mode=True, max_new_tokens=240, do_sample=True,
                temperature=.9, top_k=50, top_p=1.0, repetition_penalty=1.05)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def words(text):
    return re.findall(r"[a-zа-я0-9]+", text.lower().replace("ё", "е"))


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def trim(y, sr, np, margin=.08):
    # Exactly the approved pilot's external-silence threshold; retain 80 ms.
    hop = round(sr * .01)
    padded = np.pad(y, (0, (-len(y)) % hop))
    rms = np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1))
    active = np.flatnonzero(rms > max(.002, float(rms.max()) * .025))
    if not len(active):
        raise ValueError("Silent audio")
    lo = max(0, active[0] * hop - round(margin * sr))
    hi = min(len(y), (active[-1] + 1) * hop + round(margin * sr))
    return y[lo:hi], [lo / sr, hi / sr]


def loudness(path, ffmpeg):
    value = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf8", errors="replace", check=True).stderr
    return json.loads(value[value.rfind("{"):value.rfind("}") + 1])


def encode(wav, mp3, duration, ffmpeg):
    measured = loudness(wav, ffmpeg)
    filters = "loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:" + ":".join([
        f"measured_I={measured['input_i']}", f"measured_TP={measured['input_tp']}",
        f"measured_LRA={measured['input_lra']}", f"measured_thresh={measured['input_thresh']}",
        f"offset={measured['target_offset']}"])
    filters += f",afade=t=in:st=0:d=0.006,afade=t=out:st={max(0, duration-.012):.5f}:d=0.012"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
        "-af", filters, "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)], check=True)


def analyze(mp3, sf, np, ffmpeg):
    y, sr = sf.read(mp3, dtype="float32")
    if y.ndim != 1 or sr != 24000 or not np.isfinite(y).all() or np.max(np.abs(y)) >= .99:
        raise ValueError(f"Invalid encoded audio: {mp3.name}")
    duration = len(y) / sr
    if not .2 < duration < 12:
        raise ValueError(f"Unexpected duration: {mp3.name} {duration}")
    _, active = trim(y, sr, np, 0)
    levels = loudness(mp3, ffmpeg)
    return dict(duration=duration, sampleRate=sr, channels=1, peak=float(np.max(np.abs(y))),
        clippedFraction=float(np.mean(np.abs(y) >= .999)), leadingSilence=active[0],
        trailingSilence=max(0, duration-active[1]), integratedLUFS=float(levels["input_i"]),
        truePeakDBFS=float(levels["input_tp"]), bytes=mp3.stat().st_size, sha256=sha(mp3))


def check_name_spelling(row, output, model_dir):
    """One reviewed spelling ambiguity, never a general ASR typo whitelist.

    The name's unstressed final /o/ can be transcribed as Russian а. Preserve the
    failed exact comparison and require both independent small-model decoders
    to agree on every other word. No target prompt or corrected ASR is stored.
    """
    if row["id"] != "faceoff-greeting-open" or row.get("exactWordMatch") or not model_dir:
        return
    target = words("Вот мы и встретились, Джотаро!")
    alternate = target[:-1] + ["джотара"]
    if words(row["text"]) != target or words(row.get("asrText", "")) != alternate:
        return
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")
    independent = []
    for beam in [5, 1]:
        segments, _ = model.transcribe(str(output), language="ru", beam_size=beam,
            condition_on_previous_text=False, vad_filter=False, word_timestamps=True)
        segments = list(segments)
        independent.append({"model": "Systran/faster-whisper-small", "device": "cpu/int8",
            "beam": beam, "targetTextPrompt": False, "text": " ".join(s.text.strip() for s in segments),
            "words": [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                for s in segments for w in (s.words or [])]})
    row["independentAsr"] = independent
    matches = all(words(item["text"]) in [target, alternate] for item in independent)
    row["nameSpellingException"] = {
        "allowedOnlyFor": "faceoff-greeting-open", "target": "Джотаро", "recognized": "Джотара",
        "reason": "Unstressed final о/а spelling ambiguity; all preceding words match exactly in turbo and independent small beam 1/5. This is a phonetic inference, not a claim of listening approval.",
        "independentAgreement": matches, "rawAsrPreserved": True}
    row["passed"] = matches and row.get("technicalPass", False) and not row.get("unexpectedReferenceWords")
    row["asrAcceptance"] = "documented-name-spelling-only" if row["passed"] else "failed"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--asr-model", type=Path, required=True)
    p.add_argument("--pilot", type=Path, required=True, help="Accepted dio-b-icl.mp3, copied byte-for-byte")
    p.add_argument("--work", type=Path, required=True, help="External raw WAV/attempt archive")
    p.add_argument("--reference", type=Path, default=ROOT / "public/assets/voices/greeting.mp3")
    p.add_argument("--script", type=Path, default=ROOT / "scripts/voice-production/spoken-script.json")
    p.add_argument("--output", type=Path, default=ROOT / "public/assets/voices/spoken-v2")
    p.add_argument("--report", type=Path, default=ROOT / "scripts/voice-production/dio-pack-analysis.json")
    p.add_argument("--catalog", type=Path, default=ROOT / "shared/generated-dio-voice-clips.js")
    p.add_argument("--phase", choices=["all", "synth", "asr", "finalize"], default="all")
    p.add_argument("--only", help="Comma-separated exact p2 IDs; do not rerun passing takes")
    p.add_argument("--seed", type=int, default=62202)
    p.add_argument("--asr-device", choices=["cuda", "cpu"], default="cuda")
    p.add_argument("--name-check-model", type=Path, help="Local faster-whisper-small; optional CPU check of the single reviewed Джотаро/Джотара spelling ambiguity")
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
    lines = [u for u in json.loads(args.script.read_text(encoding="utf8"))["utterances"] if u["speaker"] == "p2"]
    assert len(lines) == 29 and len({u["id"] for u in lines}) == 29
    assert next(u for u in lines if u["id"] == ACCEPTED_ID)["text"] == ACCEPTED_TEXT
    selection = set(args.only.split(",")) if args.only else {u["id"] for u in lines}
    if selection - {u["id"] for u in lines}:
        raise ValueError("--only must contain existing p2 IDs")
    if args.seed != 62202 and not args.only:
        raise ValueError("A retry seed requires explicit --only IDs")
    if sha(args.reference) != REFERENCE_HASH or sha(args.pilot) != ACCEPTED_HASH:
        raise ValueError("Reference/accepted pilot differs from approved bytes")
    report = json.loads(args.report.read_text(encoding="utf8")) if args.report.exists() else {
        "model": MODEL_ID, "revision": MODEL_REVISION, "modelLicense": "Apache-2.0",
        "mode": "full-icl", "dtype": "bfloat16", "attention": "sdpa", "generationSettings": SETTINGS,
        "reference": {"source": "public/assets/voices/greeting.mp3", "sha256": REFERENCE_HASH,
            "range": list(REFERENCE_RANGE), "refText": REFERENCE_TEXT, "xVectorOnly": False},
        "acceptedPilot": {"id": ACCEPTED_ID, "original": "dio-b-icl.mp3", "sha256": ACCEPTED_HASH,
            "userReview": "User approved the expressive Dio pilot; production uses a byte-identical copy."},
        "processing": {"tempo": 1, "pitchShift": 0, "silenceMargin": .08,
            "normalization": "two-pass -18 LUFS / -1.5 dBTP / LRA 11", "mp3": "mono 24 kHz 128 kbit/s"},
        "runtime": {"python": __import__("sys").version, "packages": {name: importlib.metadata.version(name)
            for name in ["torch", "transformers", "qwen-tts", "faster-whisper", "soundfile", "numpy", "librosa", "imageio-ffmpeg"]}},
        "auditoryReview": "Only the copied pilot has user listening approval. Measurements/ASR do not assert listening or actor similarity for the other takes.",
        "clips": [], "attemptHistory": []}
    report["runtime"]["packages"]["faster-whisper"] = importlib.metadata.version("faster-whisper")
    report["generatorSha256"] = hashlib.sha256(Path(__file__).read_text(encoding="utf8").encode("utf8")).hexdigest()
    report["generatorHashEncoding"] = "UTF-8 with LF line endings"
    rows = {row["id"]: row for row in report["clips"]}
    def save():
        report["clips"] = [rows[u["id"]] for u in lines if u["id"] in rows]
        dump(args.report, report)
    if args.phase in ["all", "synth"]:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA required; never silently start CPU TTS")
        from qwen_tts import Qwen3TTSModel
        model = Qwen3TTSModel.from_pretrained(str(args.model), device_map="cuda:0",
            dtype=torch.bfloat16, attn_implementation="sdpa")
        ref, sr = sf.read(args.reference, dtype="float32")
        if ref.ndim == 2:
            ref = ref.mean(axis=1)
        ref = ref[round(REFERENCE_RANGE[0]*sr):round(REFERENCE_RANGE[1]*sr)]
        refpath = args.work / "dio-taunt-reference.wav"
        sf.write(refpath, ref, sr, subtype="PCM_16")
        ref, sr = sf.read(refpath, dtype="float32")
        prompt = model.create_voice_clone_prompt(ref_audio=(ref, sr), ref_text=REFERENCE_TEXT, x_vector_only_mode=False)
        for line in lines:
            clip_id = line["id"]
            if clip_id not in selection:
                continue
            print(f"SYNTH {clip_id}", flush=True)
            output = args.output / (clip_id + ".mp3")
            if clip_id in rows:
                report["attemptHistory"].append(rows[clip_id])
                if output.exists():
                    shutil.copyfile(output, args.work / f"{clip_id}-previous-{rows[clip_id]['sha256'][:12]}.mp3")
            row = {"id": clip_id, "speaker": "p2", "text": line["text"], "seed": args.seed,
                "source": "full-icl", "scriptMaxDuration": line["maxDuration"], "tempo": 1}
            if clip_id == ACCEPTED_ID:
                # A fresh checkout already contains the accepted take. Allow
                # it as the reference without depending on a pilot worktree.
                if args.pilot.resolve() != output.resolve():
                    shutil.copyfile(args.pilot, output)
                row.update(source="approved-pilot-byte-copy", seed=62202, rawDuration=2.64, trim=[.01, 2.64])
            else:
                torch.manual_seed(args.seed)
                started = time.perf_counter()
                with torch.inference_mode():
                    waves, sr = model.generate_voice_clone(text=line["text"], language="Russian",
                        voice_clone_prompt=prompt, **SETTINGS)
                raw = np.asarray(waves[0], dtype=np.float32)
                if not np.isfinite(raw).all() or not .2 < len(raw)/sr < 12 or np.max(np.abs(raw)) >= .999:
                    raise ValueError(f"Invalid raw audio: {clip_id}")
                sf.write(args.work / f"{clip_id}-seed{args.seed}-raw.wav", raw, sr, subtype="FLOAT")
                y, trimmed = trim(raw, sr, np)
                n = round(sr * .006)
                y[:n] *= np.linspace(0, 1, n)
                y[-n:] *= np.linspace(1, 0, n)
                wav = args.work / f"{clip_id}-seed{args.seed}.wav"
                sf.write(wav, y, sr, subtype="FLOAT")
                encode(wav, output, len(y)/sr, ffmpeg)
                row.update(rawDuration=len(raw)/sr, trim=trimmed, generationSeconds=round(time.perf_counter()-started, 3))
            row.update(analyze(output, sf, np, ffmpeg))
            rows[clip_id] = row
            save()
            print(json.dumps({"id": clip_id, "duration": row["duration"], "seed": row["seed"]}), flush=True)
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
        asr = AutoModelForSpeechSeq2Seq.from_pretrained(str(args.asr_model), dtype=dtype,
            low_cpu_mem_usage=True, attn_implementation="sdpa").to(args.asr_device)
        processor = AutoProcessor.from_pretrained(str(args.asr_model))
        transcribe = pipeline("automatic-speech-recognition", model=asr, tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor, dtype=dtype,
            device="cuda:0" if args.asr_device == "cuda" else "cpu")
        report["asr"] = {"model": "openai/whisper-large-v3-turbo", "revision": ASR_REVISION,
            "device": args.asr_device, "language": "ru", "numBeams": 5, "targetTextPrompt": False,
            "comparison": "Exact word sequence, ignoring punctuation, case and yo/e only; no aliases or target prompt."}
        for line in lines:
            clip_id = line["id"]
            if clip_id not in selection:
                continue
            row = rows[clip_id]
            y, sr = sf.read(args.output / (clip_id + ".mp3"), dtype="float32")
            wave = librosa.resample(y, orig_sr=sr, target_sr=16000)
            result = transcribe({"raw": wave, "sampling_rate": 16000}, generate_kwargs={
                "language": "ru", "task": "transcribe", "num_beams": 5, "condition_on_prev_tokens": False})
            row["asrText"] = result["text"].strip()
            target, actual = words(row["text"]), words(row["asrText"])
            row["exactWordMatch"] = actual == target
            row["unexpectedReferenceWords"] = [w for w in ["джотаро", "джоторо", "сделаешь"] if w in actual and w not in target]
            row["technicalPass"] = row["clippedFraction"] == 0 and row["leadingSilence"] <= .2 and row["trailingSilence"] <= .2 and row["truePeakDBFS"] < -1
            row["passed"] = row["exactWordMatch"] and not row["unexpectedReferenceWords"] and row["technicalPass"]
            row["asrAcceptance"] = "exact-word-sequence" if row["passed"] else "failed"
            save()
            print(json.dumps({"id": clip_id, "text": row["asrText"], "pass": row["passed"]}, ensure_ascii=True), flush=True)
        del transcribe, processor, asr
        gc.collect()
        torch.cuda.empty_cache()
        print("ASR_MODEL_RELEASED", flush=True)
    if args.phase in ["all", "asr", "finalize"]:
        for row in rows.values():
            if row.get("passed") and row.get("exactWordMatch"):
                row["asrAcceptance"] = "exact-word-sequence"
        greeting = rows.get("faceoff-greeting-open")
        if greeting and not greeting.get("passed"):
            check_name_spelling(greeting, args.output / "faceoff-greeting-open.mp3", args.name_check_model)
        failures = [u["id"] for u in lines if not rows.get(u["id"], {}).get("passed")]
        report["failedOrMissing"] = failures
        save()
        if failures:
            print("TARGETED_RETRY_REQUIRED " + ",".join(failures), flush=True)
            raise SystemExit(2)
        for line in lines:
            row = rows[line["id"]]
            if row["text"] != line["text"]:
                raise ValueError("Script changed after synthesis: rerender/recheck the affected line")
            if sha(args.output / (line["id"] + ".mp3")) != row["sha256"]:
                raise ValueError("Stale metrics: asset bytes changed")
        catalog = {u["id"]: {"url": "/assets/voices/spoken-v2/" + u["id"] + ".mp3",
            "text": u["text"], "duration": rows[u["id"]]["duration"], "speaker": "p2"} for u in lines}
        args.catalog.write_text("// Full-ICL Dio pack; see docs/DIO-SPOKEN-PACK.md.\nexport const GENERATED_DIO_VOICE_CLIPS = Object.freeze(" +
            json.dumps(catalog, ensure_ascii=False, indent=2) + ");\n", encoding="utf8")
        print("CATALOG_COMPLETE 29", flush=True)


if __name__ == "__main__":
    main()
