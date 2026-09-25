# Следующий голосовой пилот: CosyVoice3

Исследование и подготовка окружения, 2026-09-25. Новые тексты `b395e20` не изменены. Эта задача не запускала синтез, не оценивала звук на слух и не меняла production-аудио. Сценарная документация сохранена отдельным коммитом `3adafb8`.

## Почему прежний Qwen-пилот не гарантировал остальные фразы

Пользователь одобрил конкретный Original B, а новую фразу про броню услышал другим голосом и с неверной интонацией. Это подтверждает недостаточность переноса рецепта на весь пакет; причина изменения тембра на слух этим исследованием не установлена.

В установленном Qwen Base `generate_voice_clone` получает текст, язык и reusable prompt из `ref_code`, `ref_spk_embedding`, `ref_text`. Генератор передаёт `synthesisText`; описания `emotionalDirection` не поступают в модель. В этом API нет отдельного документированного аргумента актёрской инструкции, который есть у VoiceDesign/CustomVoice. Повторение seed задаёт случайную последовательность, но при другом тексте меняются условные вероятности каждого шага — оно не фиксирует исполнение. [Официальный API Qwen](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/qwen_tts/inference/qwen3_tts_model.py).

Предположение для проверки: референс из двух выкриков плохо задаёт разговорный регистр и разнообразие фонем; пунктуация новой реплики дополнительно меняет рисунок речи. Ни ASR, ни совпадение embedding не подтверждают голосовое сходство или «мужской/женский» тембр. Нельзя объявлять все новые строки одобренными по одному удачному пилоту.

## Основной путь: инструкция и исходный тембр одновременно

Код: `QwenAudio/CosyVoice`, revision `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`. Модель: `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, revision `29e01c4e8d000f4bcd70751be16fa94bf3d85a18`, Apache-2.0, без gated-доступа. Русский входит в заявленные девять языков. Это основание для пилота, не гарантия удачного русского дубля. [Модель](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512), [описание языков](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/README.md).

В коде `CosyVoice3` наследует `inference_instruct2(tts_text, instruct_text, prompt_wav, zero_shot_spk_id='', stream=False, speed=1.0, text_frontend=True)`. Его frontend убирает reference speech tokens из LLM, но сохраняет speaker embedding, акустические признаки и prompt tokens для flow. Значит инструкция по подаче и голосовой аудиореференс реально участвуют одновременно. Транскрипцию референса к инструкции приписывать не требуется. [Класс и API](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/cosyvoice.py#L164), [frontend_instruct2](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/frontend.py#L195).

Стартовать с официального angry instruction, без добавленных выдуманных тегов: `You are a helpful assistant. 请非常生气地说一句话。<|endofprompt|>`. Сравнить с нейтральным `You are a helpful assistant.<|endofprompt|>` на одном и том же тексте/референсе. Это проверяет влияние именно инструкции. [Поддерживаемый список](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/utils/common.py#L25).

```python
from cosyvoice.cli.cosyvoice import AutoModel

model = AutoModel(model_dir="C:/Temp/hsr-cosyvoice3/model",
                  fp16=True, load_trt=False, load_vllm=False)
parts = model.inference_instruct2(
    "Дио. Сегодня гнётся не моя броня.",
    "You are a helpful assistant. 请非常生气地说一句话。<|endofprompt|>",
    "C:/Temp/hsr-cosyvoice3/jotaro-original.wav",
    stream=False, speed=1.0, text_frontend=False)
# Собрать все part['tts_speech'] по последней оси и сохранить PCM WAV.
```

Код выше — переданный интегратору путь запуска, не выполненный здесь синтез. WAV исходника должен содержать выбранный полный `jotaro-dio.mp3`, без смены высоты/темпа. `text_frontend=False` сохраняет русский текст: иначе ветка non-Chinese использует английскую нормализацию. Выход модели — 24000 Гц. Источник допускается до 30 с. [Frontend](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/frontend.py#L89), [конфигурация модели](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/blob/29e01c4e8d000f4bcd70751be16fa94bf3d85a18/cosyvoice3.yaml).

Узкий весовой набор: `llm.pt` 2,025 GB, `flow.pt` 1,329 GB, `hift.pt` 83 MB, `speech_tokenizer_v3.onnx` 969 MB, `campplus.onnx` 28 MB, `CosyVoice-BlankEN/*` около 988 MB и `cosyvoice3.yaml`. Всего около 5,42 GB, без `llm.rl.pt`, batch-tokenizer и TensorRT ONNX. `CosyVoice-BlankEN/model.safetensors` необходим: `Qwen2Encoder` вызывает `from_pretrained` до загрузки полного LLM. По размерам и FP16 короткий одиночный пилот выглядит реалистично для RTX4080 16 GB, но пик памяти здесь не измерялся. [Дерево весов](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/tree/29e01c4e8d000f4bcd70751be16fa94bf3d85a18), [Qwen2Encoder](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/llm/llm.py).

## Окружение Windows: что действительно проверено

Создан `C:/Temp/hsr-cosyvoice3/venv`, Python 3.12.14. `.pth` подключает Qwen site-packages как внешнюю основу и каталоги CosyVoice/Matcha. Исходное окружение Qwen не изменялось: после установки там по-прежнему torch/torchaudio `2.8.0+cu128`, transformers `4.57.3`, NumPy `2.5.3`, librosa `1.0.0`, soundfile `0.14.0`.

Новый env использует этот Torch без повторной загрузки. Локально установлены upstream-пины transformers `4.51.3`, tokenizers `0.21.1`, NumPy `1.26.4`, SciPy `1.13.1`, librosa `0.10.2`, soundfile `0.12.1`, HyperPyYAML `1.2.3`, ModelScope `1.20.0`, Lightning `2.2.4`, diffusers `0.29.0`, x-transformers `2.11.24` и необходимые транзитивные пакеты. Полный список 55 локальных пакетов: `C:/Temp/hsr-cosyvoice3/requirements-overlay.txt`; версии, ограничения и происхождение: `C:/Temp/hsr-cosyvoice3/setup-report.json`.

Реальные адаптации:

- `pyworld==0.3.5`: есть Windows cp312 wheel, в отличие от upstream `0.3.4`. Модуль нужен даже без обучения, потому что YAML импортирует dataset processor.
- Whisper `20231117` собран с локальным setuptools `70.3.0`, wheel `0.45.1` и `--no-build-isolation`: новый build-setuptools не содержал `pkg_resources`.
- Matcha revision `dd9105b34bf2be2230f4aa1e4769fb586a3c824e` требует Lightning, matplotlib, gdown и wget при импорте, хотя это offline inference.
- CPU onnxruntime `1.30.0` взят из общей основы. Frontend запрашивает CUDA provider при доступном Torch CUDA: для предсказуемого CPU-tokenizer интегратору стоит явно выбрать CPU provider в локальном harness либо проверить fallback ORT.
- Не установлены wetext/ttsfrd, Gradio, FastAPI/gRPC, TensorRT, vLLM и DeepSpeed. Для этого пилота они не нужны. [Upstream зависимости](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/requirements.txt), [Pyworld wheel metadata](https://pypi.org/pypi/pyworld/0.3.5/json).

`import-preflight.py`: импорт `AutoModel` и `load_hyperpyyaml` успешен. `config-import-preflight.py`: разрешены все 32 callable targets из реального `cosyvoice3.yaml`, без вызова конструкторов. Оба скрипта отключают CUDA и внешние модельные загрузки. Модель не создавалась; GPU inference остаётся отдельной проверкой. `pip check` видит единственный ожидаемый конфликт qwen-tts → transformers из общей `.pth`: запускать Qwen следует прежним Python, а не этим Cosy env.

## Резерв: Seed-VC для уже сыгранной реплики

Seed-VC `51383efd921027683c89e5348211d93ff12ac2a8`, GPL-3.0, принимает source speech и отдельный target voice. Для маленького offline-пилота entry `inference.py`, модель `seed-uvit-whisper-small-wavenet`, 22050 Гц; настройки: 30 diffusion steps, CFG 0.7, length-adjust 1, F0-condition False, FP16 True. Узкий набор — checkpoint 440 MB, Whisper-small, CAMPPlus 28 MB и BigVGAN generator 449 MB. V2 добавляет AR/CFM/ASTRAL/HuBERT; `convert-style=false` сохраняет разделение подачи source и тембра target, тогда как true дополнительно переносит акцент/эмоцию. Русская разборчивость и локальный запуск не проверены. [Официальный репозиторий](https://github.com/Plachtaa/seed-vc/tree/51383efd921027683c89e5348211d93ff12ac2a8), [v1 entry](https://github.com/Plachtaa/seed-vc/blob/51383efd921027683c89e5348211d93ff12ac2a8/inference.py), [v2 conversion](https://github.com/Plachtaa/seed-vc/blob/51383efd921027683c89e5348211d93ff12ac2a8/modules/v2/vc_wrapper.py).

Этот резерв полезен только после появления правильного исполнения с точными словами. Он не исправит ошибочно сказанную фразу и не заменяет режиссуру. Сначала нужен короткий CosyVoice A/B, затем прослушивание пользователем; новая массовая генерация этой задачей не разрешалась и не запускалась.
