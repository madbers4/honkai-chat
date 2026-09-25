"""Transcribe a bounded set of local voice clips without a text/language hint.

The output is technical evidence only. It does not approve acting or identity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re


def words(text):
    return re.findall(r"[a-zа-я0-9]+", text.lower().replace("ё", "е"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--only", help="Comma-separated IDs; otherwise all existing files from the script")
    args = parser.parse_args()
    lines = json.loads(args.script.read_text(encoding="utf8"))["utterances"]
    selected = set(args.only.split(",")) if args.only else {line["id"] for line in lines if (args.audio / (line["id"] + ".mp3")).is_file()}
    if not selected or not selected <= {line["id"] for line in lines}:
        parser.error("Empty or unknown selection")
    for clip_id in selected:
        if not (args.audio / (clip_id + ".mp3")).is_file():
            parser.error("Missing audio: " + clip_id)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import librosa
    import soundfile as sf
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
    model = AutoModelForSpeechSeq2Seq.from_pretrained(str(args.model), dtype=torch.float16,
        low_cpu_mem_usage=True, attn_implementation="sdpa").to("cuda")
    processor = AutoProcessor.from_pretrained(str(args.model))
    transcribe = pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor, dtype=torch.float16, device="cuda:0")
    report = {"model": "openai/whisper-large-v3-turbo", "revision": "41f01f3fe87f28c78e2fbf8b568835947dd65ed9",
        "targetTextPrompt": False, "forcedLanguage": False, "numBeams": 5,
        "allRecordingsListeningApproved": False, "clips": []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for line in lines:
        if line["id"] not in selected:
            continue
        path = args.audio / (line["id"] + ".mp3")
        y, sr = sf.read(path, dtype="float32")
        if y.ndim == 2:
            y = y.mean(axis=1)
        wave = librosa.resample(y, orig_sr=sr, target_sr=16000)
        result = transcribe({"raw": wave, "sampling_rate": 16000}, generate_kwargs={
            "task": "transcribe", "num_beams": 5, "condition_on_prev_tokens": False})
        text = result["text"].strip()
        row = {"id": line["id"], "text": line["text"], "asrText": text,
            "exactWordMatch": words(text) == words(line["text"]),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        report["clips"].append(row)
        report["failed"] = [row["id"] for row in report["clips"] if not row["exactWordMatch"]]
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        print(json.dumps(row, ensure_ascii=True), flush=True)
    print("ASR_COMPLETE " + str(len(report["clips"])) + " / failed " + str(len(report["failed"])), flush=True)
    raise SystemExit(2 if report["failed"] else 0)


if __name__ == "__main__":
    main()
