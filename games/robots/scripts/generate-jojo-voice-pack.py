"""Generate the six new, reference-conditioned robot voice lines offline.

Install/download instructions and provenance: docs/generated-voice-pack.md.
Model/runtime caches and raw WAVs belong outside the production repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
REFERENCES = {
    "jotaro": "Джот - Похоже ты и правда не прост.mp3",
    "dio": "Дио - Ха, ну вперед, Герой.mp3",
}
LINES = [
    ("jotaro-mode", "jotaro", "Боевой режим: кабачковое противостояние!", 41807),
    ("dio-mode", "dio", "Твой гарантийный талон уже мёртв.", 41808),
    ("jotaro-round-1", "jotaro", "Подойди. Проверим твою сборку.", 41809),
    ("jotaro-round-2", "jotaro", "Меньше пафоса. Лови искру!", 41813),
    ("dio-round-1", "dio", "Твоя зарядка закончилась!", 41811),
    ("dio-round-2", "dio", "Я отменяю твою гарантию!", 41812),
]


def trim_silence(audio, sample_rate, np, margin=0.08):
    """Keep consonants and room tails: 10 ms RMS windows plus 80 ms margin."""
    hop = max(1, round(sample_rate * 0.01))
    padded = np.pad(audio, (0, (-len(audio)) % hop))
    rms = np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1))
    active = np.flatnonzero(rms > max(0.002, float(rms.max()) * 0.04))
    if not len(active):
        raise ValueError("Silent reference or generated utterance")
    start = max(0, active[0] * hop - round(sample_rate * margin))
    end = min(len(audio), (active[-1] + 1) * hop + round(sample_rate * margin))
    return audio[start:end], (start / sample_rate, end / sample_rate)


def encode_mp3(source, target, duration, ffmpeg, tempo=1.0):
    # Two-pass normalization preserves dynamics, with small anti-click fades.
    timing = f"atempo={tempo:.8f}," if tempo != 1.0 else ""
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(source), "-af",
         timing + "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stderr
    measurements = json.loads(probe[probe.rfind("{"):probe.rfind("}") + 1])
    normalization = (
        "loudnorm=I=-16:TP=-1.5:LRA=7:linear=true"
        f":measured_I={measurements['input_i']}"
        f":measured_TP={measurements['input_tp']}"
        f":measured_LRA={measurements['input_lra']}"
        f":measured_thresh={measurements['input_thresh']}"
        f":offset={measurements['target_offset']}"
    )
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
         "-af", timing + normalization + f",afade=t=in:st=0:d=0.006,afade=t=out:st={max(0, duration / tempo - .012):.5f}:d=0.012",
         "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", str(target)],
        check=True,
    )
    return measurements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("public/assets/voices/generated"))
    parser.add_argument("--manifest", type=Path, default=Path("shared/generated-voice-clips.js"))
    parser.add_argument("--ffmpeg", help="Defaults to imageio-ffmpeg's bundled binary")
    parser.add_argument("--asr-model-dir", type=Path, help="Optional local faster-whisper model for independent Russian transcription")
    parser.add_argument("--only", choices=[row[0] for row in LINES], help="Generate a single pilot; do not write the full manifest")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel
    if not torch.cuda.is_available():
        raise RuntimeError("This bounded recipe requires CUDA; it does not silently start a long CPU run")
    if args.ffmpeg:
        ffmpeg = args.ffmpeg
    else:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    model = Qwen3TTSModel.from_pretrained(
        str(args.model_dir), device_map="cuda:0", dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    prompts = {}
    provenance = {}
    for speaker, name in REFERENCES.items():
        source = args.reference_dir / name
        ref, rate = sf.read(source, dtype="float32")
        if ref.ndim == 2:
            ref = ref.mean(axis=1)
        # Original pilot used a slightly stricter threshold for references.
        hop = max(1, round(rate * .01))
        padded = np.pad(ref, (0, (-len(ref)) % hop))
        rms = np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1))
        active = np.flatnonzero(rms > max(.004, float(rms.max()) * .06))
        if not len(active):
            raise ValueError(f"Silent reference: {name}")
        start = max(0, active[0] * hop - round(rate * .08))
        end = min(len(ref), (active[-1] + 1) * hop + round(rate * .08))
        ref = ref[start:end]
        # Quantize identically to the pilot's intermediate PCM16 WAV.
        ref_path = args.work_dir / f"reference-{speaker}.wav"
        sf.write(ref_path, ref, rate, subtype="PCM_16")
        ref, rate = sf.read(ref_path, dtype="float32")
        with torch.inference_mode():
            prompts[speaker] = model.create_voice_clone_prompt(
                ref_audio=(ref, rate), x_vector_only_mode=True,
            )
        provenance[speaker] = {
            "filename": name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "trim": [start / rate, end / rate], "duration": len(ref) / rate,
        }
    report = {
        "model": MODEL_ID, "modelRevision": MODEL_REVISION,
        "modelLicense": "Apache-2.0", "mode": "x_vector_only",
        "dtype": "bfloat16", "attention": "sdpa", "references": provenance,
        "clips": [],
    }
    reference_embeddings = {
        speaker: prompt[0].ref_spk_embedding.float() / prompt[0].ref_spk_embedding.float().norm()
        for speaker, prompt in prompts.items()
    }
    report["referenceSpeakerCosine"] = round(float(torch.dot(reference_embeddings["jotaro"], reference_embeddings["dio"])), 5)
    manifest = {}
    for clip_id, speaker, text, seed in LINES:
        if args.only and args.only != clip_id:
            continue
        print(f"Generating {clip_id}", flush=True)
        torch.manual_seed(seed)
        started = time.perf_counter()
        with torch.inference_mode():
            waveforms, rate = model.generate_voice_clone(
                text=text, language="Russian", voice_clone_prompt=prompts[speaker],
                non_streaming_mode=True, max_new_tokens=180,
                do_sample=True, top_k=50, top_p=1.0, temperature=.9,
                repetition_penalty=1.05,
            )
        raw = np.asarray(waveforms[0], dtype=np.float32)
        raw_path = args.work_dir / f"{clip_id}-raw.wav"
        if not np.isfinite(raw).all() or not .3 <= len(raw) / rate <= 7:
            raise ValueError(f"Invalid or overlong generation: {clip_id}")
        if np.mean(np.abs(raw) >= .999) > .001:
            raise ValueError(f"Clipped generation: {clip_id}")
        sf.write(raw_path, raw, rate, subtype="PCM_16")
        trimmed, trim = trim_silence(raw, rate, np)
        normalized_input = args.work_dir / f"{clip_id}-trimmed.wav"
        sf.write(normalized_input, trimmed, rate, subtype="PCM_16")
        output = args.output_dir / f"{clip_id}.mp3"
        # Keep round callouts below three seconds without changing vocal pitch.
        tempo = max(1.0, len(trimmed) / rate / 2.98) if "-round-" in clip_id else 1.0
        if tempo > 1.12:
            raise ValueError(f"Round callout needs a shorter take: {clip_id}")
        loudness = encode_mp3(normalized_input, output, len(trimmed) / rate, ffmpeg, tempo)
        decoded, decoded_rate = sf.read(output, dtype="float32")
        if not np.isfinite(decoded).all() or np.max(np.abs(decoded)) >= .99:
            raise ValueError(f"Invalid encoded audio: {clip_id}")
        duration = len(decoded) / decoded_rate
        manifest[clip_id] = {
            "url": f"/assets/voices/generated/{clip_id}.mp3", "text": text,
            "duration": round(duration, 4), "speaker": speaker,
        }
        row = {
            "id": clip_id, "speaker": speaker, "text": text, "seed": seed,
            "rawDuration": len(raw) / rate, "duration": duration, "trim": trim, "tempo": tempo,
            "sampleRate": decoded_rate, "channels": 1, "peak": float(np.max(np.abs(decoded))),
            "rms": float(np.sqrt(np.mean(decoded ** 2))), "clippedFraction": float(np.mean(np.abs(decoded) >= .999)),
            "bytes": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "generationAndEncodingSeconds": round(time.perf_counter() - started, 3),
            "normalizationInput": loudness,
        }
        # Diagnostic only: embedding similarity is not a perceptual quality score.
        with torch.inference_mode():
            encoded_prompt = model.create_voice_clone_prompt(ref_audio=(decoded, decoded_rate), x_vector_only_mode=True)
        embedding = encoded_prompt[0].ref_spk_embedding.float()
        embedding /= embedding.norm()
        row["referenceSpeakerCosine"] = {
            key: round(float(torch.dot(embedding, value)), 5) for key, value in reference_embeddings.items()
        }
        hop = round(decoded_rate * .01)
        padded = np.pad(decoded, (0, (-len(decoded)) % hop))
        rms = np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1))
        active = np.flatnonzero(rms > max(.002, float(rms.max()) * .025))
        row["leadingSilence"] = round(active[0] * .01, 3)
        row["trailingSilence"] = round(max(0, duration - (active[-1] + 1) * .01), 3)
        report["clips"].append(row)
        print(json.dumps(row, ensure_ascii=True), flush=True)
    # ASR runs after all synthesis, keeping GPU generation simple and serial.
    del prompts, model
    torch.cuda.empty_cache()
    if args.asr_model_dir:
        from faster_whisper import WhisperModel
        asr = WhisperModel(str(args.asr_model_dir), device="cpu", compute_type="int8")
        for row in report["clips"]:
            segments, _ = asr.transcribe(str(args.output_dir / (row["id"] + ".mp3")), language="ru", beam_size=5, vad_filter=False)
            row["independentAsr"] = " ".join(segment.text.strip() for segment in segments)
            normalized = lambda text: re.sub(r"[\W_]", "", text.lower().replace("ё", "е"))
            row["asrNormalizedTextMatch"] = normalized(row["text"]) == normalized(row["independentAsr"])
            print(json.dumps({"id": row["id"], "asr": row["independentAsr"]}, ensure_ascii=True), flush=True)
    report["maxCudaAllocatedGB"] = torch.cuda.max_memory_allocated() / 1e9
    (args.work_dir / "voice-pack-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.only:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(
            "// Offline reference-conditioned synthesis; see docs/generated-voice-pack.md.\n"
            "export const GENERATED_VOICE_CLIPS = Object.freeze(" + json.dumps(manifest, ensure_ascii=False, indent=2) + ");\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
