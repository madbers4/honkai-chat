import { GENERATED_DIO_VOICE_CLIPS } from './generated-dio-voice-clips.js';
import { GENERATED_JOTARO_VOICE_CLIPS } from './generated-jotaro-voice-clips.js';
// Historical assets remain available to offline production and explicit tests.
// They are never part of the current automatic dialogue catalog.
export const LEGACY_GENERATED_VOICE_CLIPS = Object.freeze({
  "jotaro-mode": {
    "url": "/assets/voices/generated/jotaro-mode.mp3",
    "text": "Боевой режим: кабачковое противостояние!",
    "duration": 3.2,
    "speaker": "jotaro"
  },
  "dio-mode": {
    "url": "/assets/voices/generated/dio-mode.mp3",
    "text": "Твой гарантийный талон уже мёртв.",
    "duration": 2.55,
    "speaker": "dio"
  },
  "jotaro-round-1": {
    "url": "/assets/voices/generated/jotaro-round-1.mp3",
    "text": "Подойди. Проверим твою сборку.",
    "duration": 2.9881,
    "speaker": "jotaro"
  },
  "jotaro-round-2": {
    "url": "/assets/voices/generated/jotaro-round-2.mp3",
    "text": "Меньше пафоса. Лови искру!",
    "duration": 2.4,
    "speaker": "jotaro"
  },
  "dio-round-1": {
    "url": "/assets/voices/generated/dio-round-1.mp3",
    "text": "Твоя зарядка закончилась!",
    "duration": 2.02,
    "speaker": "dio"
  },
  "dio-round-2": {
    "url": "/assets/voices/generated/dio-round-2.mp3",
    "text": "Я отменяю твою гарантию!",
    "duration": 2.98,
    "speaker": "dio"
  }
});

export const GENERATED_VOICE_CLIPS = Object.freeze({
  ...GENERATED_DIO_VOICE_CLIPS,
  ...GENERATED_JOTARO_VOICE_CLIPS,
});
