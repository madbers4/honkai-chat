"""Cut the user's original performances into whole speaker turns.

Requires numpy, soundfile and an explicit FFmpeg executable. Source copies are
verified against the imported user-asset manifest. No synthesis, pitch or tempo
processing is used. ASR is a separate, unprompted verification step.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

import numpy as np
import soundfile as sf


TURNS = [
    ('faceoff-greeting-open', 'p2', 'greeting', 0, 4.17, 'Вот мы и встретились, Джотаро!'),
    ('faceoff-greeting-answer', 'p1', 'greeting', 4.17, 5.685, 'Дио!'),
    ('faceoff-greeting-package', 'p2', 'greeting', 5.685, None, 'Да, я! И что? Что ты мне сделаешь, а, Джотаро?'),
    ('faceoff-challenge-p1', 'p1', 'jotaro-not-simple', 0, None, 'Яре-яре… Похоже, ты и вправду непрост, однако.'),
    ('faceoff-taunt-p2', 'p2', 'dio-angry', .24, None, 'Ха! Похоже, ты зол, Джотаро. Что случилось?'),
    ('faceoff-mode-p1', 'p1', 'jotaro-dio', .36, None, 'Ублюдок! Дио!'),
    ('faceoff-fight-p2', 'p2', 'dio-hero', 0, None, 'Ха! Ну вперёд, герой!'),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--ffmpeg', required=True)
    args = parser.parse_args()
    sources = args.root / 'public/assets/voices'
    manifest = json.loads((sources / 'manifest.json').read_text(encoding='utf8'))['clips']
    output = sources / 'faceoff-v4'
    output.mkdir(exist_ok=True)
    report = {'version': 4, 'source': 'user-provided-original-recordings',
        'allRecordingsListeningApproved': False, 'tempo': 1, 'pitchShift': 0,
        'cutPolicy': 'Complete actor turns. Greeting seams at RMS troughs 4.170 s and 5.685 s; whole words retained. Other sources preserve full endings.',
        'processing': {'sampleRate': 24000, 'channels': 1, 'mp3Kbps': 64, 'targetLUFS': -18,
            'gainPolicy': 'constant gain per turn, limited to -2 dB decoded sample peak; no compressor',
            'fadeInMs': 6, 'fadeOutMs': 12}, 'clips': []}
    with tempfile.TemporaryDirectory(prefix='original-faceoff-') as temp:
        temp = Path(temp)
        for clip_id, speaker, source_id, start, end, text in TURNS:
            source = sources / f'{source_id}.mp3'
            assert sha(source.read_bytes()) == manifest[source_id]['sha256'], source_id
            audio, sr = sf.read(source, dtype='float32')
            if audio.ndim == 2:
                audio = audio.mean(axis=1)
            end = end if end is not None else len(audio)/sr
            take = audio[round(start*sr):round(end*sr)].copy()
            raw = temp / f'{clip_id}.wav'
            sf.write(raw, take, sr, subtype='FLOAT')
            measured = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(raw), '-af',
                'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
            levels = json.loads(re.findall(r'\{[^{}]+\}', measured.stderr)[-1])
            peak = float(np.max(np.abs(take)))
            gain_db = min(-18-float(levels['input_i']), -2-20*np.log10(max(peak, 1e-8)))
            duration = len(take)/sr
            target = output / f'{clip_id}.mp3'
            subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                '-af', f'volume={gain_db:.6f}dB,afade=t=in:st=0:d=0.006,afade=t=out:st={max(0,duration-.012):.9f}:d=0.012',
                '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', str(target)], check=True)
            decoded, out_sr = sf.read(target, dtype='float32')
            final_levels = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(target), '-af',
                'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
            final_levels = json.loads(re.findall(r'\{[^{}]+\}', final_levels.stderr)[-1])
            row = {'id': clip_id, 'speaker': speaker, 'text': text, 'synthesisText': text,
                'url': f'/assets/voices/faceoff-v4/{clip_id}.mp3',
                'source': source_id, 'sourceSha256': manifest[source_id]['sha256'], 'trim': [start,end],
                'duration': len(decoded)/out_sr, 'sampleRate': out_sr, 'channels': 1,
                'bytes': target.stat().st_size, 'sha256': sha(target.read_bytes()),
                'integratedLUFS': float(final_levels['input_i']), 'truePeakDBFS': float(final_levels['input_tp']),
                'peak': float(np.max(np.abs(decoded))), 'clippedFraction': float(np.mean(np.abs(decoded)>=.999)),
                'gainDB': float(gain_db), 'sourceEngine': 'original-user-recording', 'copied': True,
                'userListeningApproved': False, 'passed': bool(np.max(np.abs(decoded))<.999)}
            report['clips'].append(row)
            print(json.dumps(row, ensure_ascii=True), flush=True)
    report['totalBytes'] = sum(row['bytes'] for row in report['clips'])
    (args.root/'scripts/voice-production/faceoff-original-v4-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__ == '__main__':
    main()
