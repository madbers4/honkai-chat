"""Offline, deterministic edits of the supplied combat recordings; never TTS.

Requires numpy, soundfile and FFmpeg. No CUDA, network, or model is used.
Source intervals were selected from 2/5 ms waveform envelopes and diagnostic
Whisper-small CPU ASR. Anime cries are not reliably transcribed by Whisper;
this script does not mistake ASR hallucinations for a listening approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'jotaro-attack-1': 'b431db10848aa8456bd50dbb1ffb6aff44e0ca6ea34be2094015b014af5499d1',
    'jotaro-attack-2': 'ed0f9f1b790ed825143114397a6a73f5910c271774ac65fc1e3a6af2ee4d0bc9',
    'jotaro-attack-3': '568aaa985e415fcda99da6c7b797688560d7861db0661e6fe42946e4b2620145',
    'dio-attack-1': '179145b679a588e75a6ecf37762aa0910e805955864b76bfb60cda9f81e36803',
    'dio-attack-2': 'd9c656f956a1a713e4ff04929bd85b1273c759e46256296d9cc7b092bcbdfa27',
    'explosion': '1bd3dacc65bfc6f7b821007673bc11cc3ebc688d212276b3563ca657de4fde38',
}
# Start/end are source PCM seconds, including the natural articulation and tail.
# No timed browser slices, time stretching, pitch shift, or repeat loops.
EDITS = [
    ('jotaro-single-a', 'jotaro', 'single', 'jotaro-attack-1', .35, 1.55, .018,
     'Whole first isolated cry; silent gaps on both sides.'),
    ('jotaro-single-b', 'jotaro', 'single', 'jotaro-attack-2', .40, 1.55, .018,
     'Whole first isolated cry; preserves the sustained vowel and decay.'),
    ('jotaro-finisher', 'jotaro', 'finisher', 'jotaro-attack-2', 1.89, 3.47, .035,
     'Whole second isolated cry, through its natural tail.'),
    ('jotaro-barrage', 'jotaro', 'barrage', 'jotaro-attack-3', .39, 3.85, .10,
     'Whole first ORA run; ends after the final voiced peak and decay.'),
    ('dio-single-a', 'dio', 'single', 'dio-attack-1', .31, .722, .009,
     'First MUDA articulation, two vowel groups; boundary is the valley before the next onset.'),
    ('dio-single-b', 'dio', 'single', 'dio-attack-1', .722, 1.066, .009,
     'Second MUDA articulation; both syllabic groups, ending at the next inter-cry valley.'),
    ('dio-finisher', 'dio', 'finisher', 'dio-attack-1', 1.066, 2.10, .14,
     'Last extended MUDA of the first run plus early reverb; late echo is faded, not a vowel.'),
    ('dio-barrage', 'dio', 'barrage', 'dio-attack-1', .31, 2.10, .14,
     'Complete short MUDA run including its extended last cry; later reverb excluded.'),
    ('dio-ultimate', 'dio', 'ultimate', 'dio-attack-2', 9.83, 13.68, .10,
     'Whole final MUDA run after the long silent gap. Excludes the preceding spoken threat.'),
    ('explosion', 'explosion', 'destruction', 'explosion', .025, 5.15, .60,
     'Initial blast and main decay; long secondary rumble removed with a 600 ms tail fade. No voice source mixed in.'),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def db(value):
    return round(float(20 * np.log10(max(value, 1e-12))), 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/voices/combat-v3')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sources, decoded, catalog, clips = {}, {}, {}, []
    for name, expected_hash in SOURCES.items():
        path = ROOT / 'public/assets/voices' / (name + '.mp3')
        if sha(path) != expected_hash:
            raise ValueError('Source changed: ' + str(path))
        y, sr = sf.read(path, dtype='float32')
        if y.ndim > 1:
            y = y.mean(axis=1)
        decoded[name] = (y, sr)
        sources[name] = {'url': '/assets/voices/' + name + '.mp3', 'sha256': expected_hash,
                         'bytes': path.stat().st_size, 'decodedDuration': len(y) / sr}
    with tempfile.TemporaryDirectory(prefix='combat-voice-') as temporary:
        for clip_id, actor, role, source, start, end, fade_out, boundary in EDITS:
            original, sr = decoded[source]
            first, last = round(start * sr), round(end * sr)
            if not 0 <= first < last <= len(original):
                raise ValueError('Invalid source interval: ' + clip_id)
            y = original[first:last].copy()
            # Short exclamations are often <400 ms (below the integrated LUFS
            # gate). Use consistent active RMS and a peak ceiling for all edits.
            active = np.abs(y) >= max(.001, float(np.abs(y).max()) * .035)
            active_rms = float(np.sqrt(np.mean(y[active] ** 2)))
            target_db = -19 if actor == 'explosion' else -18
            gain = min(10 ** (target_db / 20) / active_rms,
                       10 ** (-3.5 / 20) / float(np.abs(y).max()))
            y *= gain
            attack = round(sr * (.003 if actor == 'explosion' else .006))
            release = round(sr * fade_out)
            y[:attack] *= np.linspace(0, 1, attack, dtype=np.float32)
            y[-release:] *= np.linspace(1, 0, release, dtype=np.float32)
            wav = Path(temporary) / (clip_id + '.wav')
            output = args.output / (clip_id + '.mp3')
            sf.write(wav, y, sr, subtype='FLOAT')
            subprocess.run([str(args.ffmpeg), '-hide_banner', '-loglevel', 'error', '-y',
                '-i', str(wav), '-map_metadata', '-1', '-ar', '24000', '-ac', '1',
                '-codec:a', 'libmp3lame', '-b:a', '80k', '-write_xing', '1', str(output)], check=True)
            result, result_sr = sf.read(output, dtype='float32')
            if result_sr != 24000 or result.ndim != 1 or not np.isfinite(result).all():
                raise ValueError('Invalid output PCM: ' + clip_id)
            peak = float(np.abs(result).max())
            if peak >= 10 ** (-1.5 / 20):
                raise ValueError('Unsafe encoded peak: ' + clip_id)
            duration = len(result) / result_sr
            row = {'id': clip_id, 'actor': actor, 'role': role, 'source': source,
                   'sourceInterval': [first / sr, last / sr], 'sourceFrames': [first, last],
                   'boundaryBasis': boundary, 'gainDB': db(gain),
                   'fadeIn': attack / sr, 'fadeOut': fade_out, 'duration': duration,
                   'bytes': output.stat().st_size, 'sha256': sha(output),
                   'sampleRate': result_sr, 'channels': 1, 'samplePeakDBFS': db(peak),
                   'clippedSamples': int(np.count_nonzero(np.abs(result) >= .999)),
                   'edgeRMS': [float(np.sqrt(np.mean(result[:48]**2))), float(np.sqrt(np.mean(result[-48:]**2)))]}
            clips.append(row)
            catalog[clip_id] = {'url': '/assets/voices/combat-v3/' + clip_id + '.mp3',
                'actor': actor, 'role': role, 'duration': duration,
                'bytes': row['bytes'], 'sha256': row['sha256']}
    old_ids = ['jotaro-attack-1', 'jotaro-attack-2', 'jotaro-attack-3', 'dio-attack-1', 'dio-attack-2', 'duo-super', 'explosion']
    old_bytes = sum((ROOT / 'public/assets/voices' / (name + '.mp3')).stat().st_size for name in old_ids)
    total = sum(clip['bytes'] for clip in clips)
    report = {'recipe': 'offline-combat-edits-v3', 'sourceSelection': '2/5 ms waveform envelopes; diagnostic CPU Whisper-small, ru and ja, without target-text prompts',
        'listeningApproved': False, 'asrLimitation': 'Whisper invents normal words and music labels for short ORA/MUDA cries. No exact-word pass or listening approval is claimed.',
        'format': 'mono 24 kHz MP3 CBR 80 kbit/s; active-RMS target -18 dBFS (-19 explosion), pre-encode peak ceiling -3.5 dBFS',
        'processing': 'Preserve pitch, speed and internal timing. Only fixed source cuts, constant gain, short edge fades and one long explosion-tail fade.',
        'generatorSha256': hashlib.sha256(Path(__file__).read_text(encoding='utf8').encode('utf8')).hexdigest(),
        'generatorHashEncoding': 'UTF-8 with LF line endings',
        'ffmpegVersion': subprocess.check_output([str(args.ffmpeg), '-version'], text=True).splitlines()[0],
        'sources': sources, 'clips': clips, 'oldPreloadBytes': old_bytes, 'newPreloadBytes': total,
        'savedBytes': old_bytes - total, 'savedPercent': round((1 - total / old_bytes) * 100, 2)}
    (ROOT / 'docs/combat-voice-v3-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (ROOT / 'shared/combat-voice-clips.js').write_text('// Offline whole-cry edits; generated by scripts/prepare-combat-voice.py.\n'
        'export const COMBAT_VOICE_CLIPS = Object.freeze(' + json.dumps(catalog, ensure_ascii=False, indent=2) + ');\n', encoding='utf8')
    print(json.dumps({'clips': len(clips), 'bytesBefore': old_bytes, 'bytesAfter': total,
                      'savedPercent': report['savedPercent']}, indent=2))


if __name__ == '__main__':
    main()
