"""Export selected p1 CosyVoice3 takes for review, never activate production audio.

Only the three exact A/B/D pilot recipes are available. Model/code/reference pins
are checked locally; --validate-only performs no ML imports and writes nothing.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
MODEL_REVISION = "29e01c4e8d000f4bcd70751be16fa94bf3d85a18"
CODE_REVISION = "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"
MATCHA_REVISION = "dd9105b34bf2be2230f4aa1e4769fb586a3c824e"
ANGRY = "You are a helpful assistant. 请非常生气地说一句话。<|endofprompt|>"
ZERO_PROMPT = "You are a helpful assistant.<|endofprompt|>Ублюдок! Дио!"
REFERENCES = {
    "original": ("public/assets/voices/jotaro-dio.mp3",
                 "17bad1ef01499370b836f7a5d5761b9150d6fa23036124c095e951a54e883741"),
    "approved-b": ("public/assets/voices/spoken-v2/faceoff-challenge-p1.mp3",
                   "b70455f4432e6b4cc56d989c0cf17734e87e21a7bf5f2440cc35cec814642544"),
}
RECIPES = {
    "zero-original": {"pilotLabel": "А", "mode": "zero", "reference": "original", "instruction": ZERO_PROMPT},
    "anger-original": {"pilotLabel": "Б", "mode": "instruct", "reference": "original", "instruction": ANGRY},
    "anger-approved-b": {"pilotLabel": "Г", "mode": "instruct", "reference": "approved-b", "instruction": ANGRY},
}
# The pilot used this punctuation/case, not the Qwen-specific synthesisText.
# Preserve it without editing canonical dialogue or changing any spoken words.
PILOT_INPUTS = {"faceoff-mode-p1": "Дио! Сегодня гнётся не моя броня!"}
# Official HF metadata at MODEL_REVISION: (size, algorithm, digest).
# Non-LFS files use Git's blob hash, large model weights use their LFS SHA256.
MODEL_FILES = {
    "CosyVoice-BlankEN/config.json": (659, "git-sha1", "463b055262b6c66c4629a74a4b300bfe2ed31d3c"),
    "CosyVoice-BlankEN/generation_config.json": (242, "git-sha1", "dfc11073787daf1b0f9c0f1499487ab5f4c93738"),
    "CosyVoice-BlankEN/merges.txt": (1402109, "git-sha1", "90d3d82d027eadcc6a5e77c38eb82d43fc51b53b"),
    "CosyVoice-BlankEN/model.safetensors": (988097824, "sha256", "130282af0dfa9fe5840737cc49a0d339d06075f83c5a315c3372c9a0740d0b96"),
    "CosyVoice-BlankEN/tokenizer_config.json": (1287, "git-sha1", "ff55d7b9eb1384e5d4d7e75dc0f564c1a8833d6e"),
    "CosyVoice-BlankEN/vocab.json": (2776833, "git-sha1", "4783fe10ac3adce15ac8f358ef5462739852c569"),
    "campplus.onnx": (28303423, "sha256", "a6ac6a63997761ae2997373e2ee1c47040854b4b759ea41ec48e4e42df0f4d73"),
    "cosyvoice3.yaml": (6934, "git-sha1", "2eda7e5007d99f6b17fbe7bd751cf54e3cde29ea"),
    "flow.pt": (1329116148, "sha256", "a6fab32a7825e5b0bc855ddd948f8db9370b0a786fbc249caa4595e95b608e4b"),
    "hift.pt": (83202622, "sha256", "b279d7641eb97ae55b3b540cfba4f953c26492a2df758328a89a4d007ab87a65"),
    "llm.pt": (2024669519, "sha256", "69f43bd545131c30e98947fb360ea8b4dc9916d8e83dded7757c7ea4f5a24970"),
    "speech_tokenizer_v3.onnx": (969451503, "sha256", "23236a74175dbdda47afc66dbadd5bcb41303c467a57c261cb8539ad9db9208d"),
}


def digest(path, algorithm="sha256"):
    h = hashlib.sha1() if algorithm == "git-sha1" else hashlib.sha256()
    if algorithm == "git-sha1":
        h.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def words(text):
    return re.findall(r"[a-zа-я0-9]+", text.lower().replace("ё", "е"))


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--recipe", choices=RECIPES, required=True)
    selector = p.add_mutually_exclusive_group(required=True)
    selector.add_argument("--only", help="Comma-separated exact p1 utterance IDs")
    selector.add_argument("--actor", choices=["p1"], help="Explicitly select every p1 line")
    p.add_argument("--output", type=Path, required=True, help="New/empty directory outside any Git checkout")
    p.add_argument("--model", type=Path, required=True, help="Existing pinned local model directory")
    p.add_argument("--source-repo", type=Path, required=True, help="Pinned clean CosyVoice Git checkout with Matcha")
    p.add_argument("--script", type=Path, default=ROOT / "scripts/voice-production/spoken-script.json")
    p.add_argument("--reference", type=Path, help="Optional relocated reference; the recipe's exact hash is still required")
    p.add_argument("--ffmpeg", type=Path, help="Existing FFmpeg executable; otherwise use imageio-ffmpeg's local binary")
    p.add_argument("--seed", type=int, default=62101)
    p.add_argument("--validate-only", action="store_true", help="Check selection/pins/paths without model loading or writes")
    return p


def selected_lines(script, only=None):
    rows = script.get("utterances", [])
    if not rows or len({x["id"] for x in rows}) != len(rows):
        raise ValueError("Script must contain unique utterance IDs")
    by_id = {x["id"]: x for x in rows}
    if only is not None:
        ids = [x.strip() for x in only.split(",")]
        if not all(ids) or len(set(ids)) != len(ids):
            raise ValueError("--only must list nonempty distinct IDs")
        if any(x not in by_id or by_id[x].get("speaker") != "p1" for x in ids):
            raise ValueError("Every selected ID must exist and belong to p1")
    else:
        ids = [x["id"] for x in rows if x.get("speaker") == "p1"]
    if not ids:
        raise ValueError("No p1 lines selected")
    result = []
    for cid in ids:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", cid):
            raise ValueError("Unsafe utterance ID")
        row = by_id[cid]
        text = PILOT_INPUTS.get(cid, row.get("synthesisText", row["text"]))
        if not words(row["text"]) or words(text) != words(row["text"]):
            raise ValueError("Synthesis input changes canonical words: " + cid)
        result.append({"id": cid, "speaker": "p1", "text": row["text"], "synthesisText": text})
    return result


def external_output(path):
    path = path.expanduser().resolve()
    if any((ancestor / ".git").exists() for ancestor in [path, *path.parents]):
        raise ValueError("--output must be external to Git checkouts, including all production assets")
    if path == ROOT or ROOT in path.parents:
        raise ValueError("Cannot export into this project's checkout")
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError("--output must be a new or empty directory; previous takes are never overwritten")
    return path


def verify_repo(path, revision):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(path), *args], text=True, encoding="utf8").strip()
    if git("rev-parse", "HEAD") != revision or git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Expected pinned clean source checkout: " + str(path))


def validate(args):
    if not 0 <= args.seed < 2 ** 32:
        raise ValueError("Seed must be in [0, 2**32)")
    output = external_output(args.output)
    script_path = args.script.expanduser().resolve()
    lines = selected_lines(json.loads(script_path.read_text(encoding="utf-8-sig")), args.only)
    recipe = RECIPES[args.recipe]
    relative, expected = REFERENCES[recipe["reference"]]
    reference = (args.reference or ROOT / relative).expanduser().resolve()
    if digest(reference) != expected:
        raise ValueError("Reference does not match the selected pilot recipe")
    model = args.model.expanduser().resolve()
    repo = args.source_repo.expanduser().resolve()
    verify_repo(repo, CODE_REVISION)
    verify_repo(repo / "third_party/Matcha-TTS", MATCHA_REVISION)
    model_hashes = {}
    for relative, (size, algorithm, expected) in MODEL_FILES.items():
        path = model / relative
        if not path.is_file() or path.stat().st_size != size or digest(path, algorithm) != expected:
            raise ValueError("Missing or altered pinned model file: " + relative)
        model_hashes[relative] = {"bytes": size, "algorithm": algorithm, "digest": expected}
    return output, model, repo, reference, lines, {
        "status": "validated-not-generated", "model": MODEL_ID, "modelRevision": MODEL_REVISION,
        "codeRevision": CODE_REVISION, "matchaRevision": MATCHA_REVISION,
        "recipe": args.recipe, "recipeSettings": recipe, "seed": args.seed,
        "modelFiles": model_hashes, "reference": {"path": str(reference), "sha256": digest(reference)},
        "scriptSha256": digest(script_path), "generatorSha256": digest(Path(__file__)),
        "selection": [x["id"] for x in lines], "userListeningApproved": False,
        "pilotRecipeUserSelected": args.recipe == "zero-original",
        "approvalScope": "User selected pilot A (zero-original); new exported lines are not listening-approved.",
        "processing": {"sampleRate": 24000, "channels": 1, "mp3Kbps": 64,
                       "speed": 1.0, "pitchShift": 0, "loudness": "-18 LUFS / -1.5 dBTP / LRA11",
                       "fadesMs": [6, 12], "trimMarginSeconds": .08},
        "asr": {"status": "not-run", "targetTextPrompt": False}, "clips": [],
    }


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
    result = subprocess.run([str(ffmpeg), "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf8", errors="replace", check=True).stderr
    levels = json.loads(result[result.rfind("{"):result.rfind("}") + 1])
    if not all(math.isfinite(float(levels[x])) for x in ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]):
        raise ValueError("Invalid loudness analysis: " + path.name)
    return levels


def encode(wav, mp3, duration, ffmpeg):
    levels = loudness(wav, ffmpeg)
    filters = "loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:" + ":".join([
        f"measured_I={levels['input_i']}", f"measured_TP={levels['input_tp']}",
        f"measured_LRA={levels['input_lra']}", f"measured_thresh={levels['input_thresh']}",
        f"offset={levels['target_offset']}"])
    filters += f",afade=t=in:st=0:d=0.006,afade=t=out:st={max(0, duration-.012):.5f}:d=0.012"
    subprocess.run([str(ffmpeg), "-hide_banner", "-loglevel", "error", "-n", "-i", str(wav),
        "-af", filters, "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", str(mp3)], check=True)


def analyze(path, sf, np, ffmpeg):
    y, sr = sf.read(path, dtype="float32")
    if y.ndim != 1 or sr != 24000 or not np.isfinite(y).all() or np.max(np.abs(y)) >= .99:
        raise ValueError("Invalid MP3 PCM: " + path.name)
    duration = len(y) / sr
    if not .2 < duration < 20:
        raise ValueError("Unexpected MP3 duration: " + path.name)
    _, active = trim(y, sr, np, margin=0)
    levels = loudness(path, ffmpeg)
    return {"duration": duration, "sampleRate": sr, "channels": 1, "peak": float(np.abs(y).max()),
            "clippedFraction": float(np.mean(np.abs(y) >= .999)), "leadingSilence": active[0],
            "trailingSilence": max(0, duration-active[1]), "integratedLUFS": float(levels["input_i"]),
            "truePeakDBFS": float(levels["input_tp"]), "bytes": path.stat().st_size, "sha256": digest(path)}


def dump_report(path, report):
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def generate(args, checked):
    output, model_path, repo, reference, lines, report = checked
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path[:0] = [str(repo), str(repo / "third_party/Matcha-TTS")]
    import numpy as np
    import soundfile as sf
    import torch
    from cosyvoice.cli.cosyvoice import AutoModel
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA required for the pinned FP16 pilot recipe")
    if args.ffmpeg is None:
        import imageio_ffmpeg
        ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
    else:
        ffmpeg = args.ffmpeg.expanduser().resolve()
    report["ffmpegVersion"] = subprocess.check_output([str(ffmpeg), "-version"], text=True).splitlines()[0]
    report["packages"] = {p: importlib.metadata.version(p) for p in
                          ["torch", "torchaudio", "numpy", "soundfile", "transformers", "onnxruntime"]}
    # Recheck before the first write; no existing takes or production directories.
    external_output(output)
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "report.json"
    report["status"] = "generating-review-only"
    dump_report(report_path, report)
    try:
        ref, ref_sr = sf.read(reference, dtype="float32")
        if ref.ndim == 2:
            ref = ref.mean(axis=1)
        if ref.ndim != 1 or not np.isfinite(ref).all() or not 1 <= len(ref) / ref_sr <= 30:
            raise ValueError("Invalid reference signal")
        ref_path = output / "reference.wav"
        sf.write(ref_path, ref, ref_sr, subtype="PCM_16")
        report["reference"].update(pcmWav=ref_path.name, pcmSha256=digest(ref_path), sampleRate=ref_sr)
        model = AutoModel(model_dir=str(model_path), fp16=True, load_trt=False, load_vllm=False)
        if model.sample_rate != 24000:
            raise ValueError("Unexpected model sample rate")
        recipe = RECIPES[args.recipe]
        torch.cuda.reset_peak_memory_stats()
        for line in lines:
            random.seed(args.seed)
            np.random.seed(args.seed)
            torch.manual_seed(args.seed)
            torch.cuda.manual_seed_all(args.seed)
            start = time.perf_counter()
            method = model.inference_zero_shot if recipe["mode"] == "zero" else model.inference_instruct2
            with torch.inference_mode():
                pieces = [piece["tts_speech"].detach().float().cpu() for piece in method(
                    line["synthesisText"], recipe["instruction"], str(ref_path),
                    stream=False, speed=1.0, text_frontend=False)]
            if not pieces:
                raise ValueError("No generated audio: " + line["id"])
            raw = torch.cat(pieces, dim=1).squeeze().numpy()
            if raw.ndim != 1 or not np.isfinite(raw).all() or not .2 < len(raw) / 24000 < 20:
                raise ValueError("Invalid generated PCM: " + line["id"])
            raw_path = output / (line["id"] + "-raw.wav")
            sf.write(raw_path, raw, 24000, subtype="FLOAT")
            audio, limits = trim(raw, 24000, np)
            wav, mp3 = output / (line["id"] + ".wav"), output / (line["id"] + ".mp3")
            sf.write(wav, audio, 24000, subtype="FLOAT")
            encode(wav, mp3, len(audio) / 24000, ffmpeg)
            row = {**line, "recipe": args.recipe, "seed": args.seed, "userListeningApproved": False,
                   "rawWav": raw_path.name, "rawSha256": digest(raw_path), "rawDuration": len(raw) / 24000,
                   "rawPeak": float(np.abs(raw).max()), "rawClippedFraction": float(np.mean(np.abs(raw) >= .999)),
                   "trim": limits, "wavSha256": digest(wav),
                   "generationSeconds": round(time.perf_counter()-start, 3), **analyze(mp3, sf, np, ffmpeg)}
            report["clips"].append(row)
            report["peakCudaGB"] = torch.cuda.max_memory_allocated() / 1e9
            dump_report(report_path, report)
            print(json.dumps({"id": line["id"], "duration": row["duration"], "sha256": row["sha256"]}), flush=True)
        report["status"] = "exported-awaiting-asr-and-listening-review"
        dump_report(report_path, report)
    except Exception as exc:
        report.update(status="failed-partial-export", error=str(exc))
        dump_report(report_path, report)
        raise


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    try:
        checked = validate(args)
        if args.validate_only:
            print(json.dumps({"status": checked[-1]["status"], "recipe": args.recipe,
                              "selection": checked[-1]["selection"], "output": str(checked[0]),
                              "modelRevision": MODEL_REVISION, "writes": False, "mlImports": False}, ensure_ascii=False))
        else:
            generate(args, checked)
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        p.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
