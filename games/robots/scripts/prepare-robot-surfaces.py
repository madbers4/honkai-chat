"""Technical export of the supplied robot atlases; no painting or generated detail.

Requires Pillow. Run from any directory. Source images are read only.
"""
from pathlib import Path
from PIL import Image
import hashlib
import json

root = Path(__file__).resolve().parents[1]
source = root / 'assets-source' / 'original' / 'textures'
output = root / 'public' / 'assets' / 'robot-surfaces'
output.mkdir(parents=True, exist_ok=True)

base_path = source / 'BaseColor.png'
roughness_path = source / 'Metallic_png-Roughness_png@channels=G.png'
metalness_path = source / 'Metallic_png-Roughness_png@channels=B.png'
base = Image.open(base_path).convert('RGB')
assert base.size == (2048, 2048)
base.save(output / 'base-color-2048.webp', quality=94, method=6)

roughness = Image.open(roughness_path).convert('L').resize((1024, 1024), Image.Resampling.LANCZOS)
metalness = Image.open(metalness_path).convert('L').resize((1024, 1024), Image.Resampling.LANCZOS)
# glTF convention, linear scalar data. Lossless avoids colour crosstalk between
# neighbouring roughness and metalness channels during WebP YUV conversion.
packed = Image.merge('RGB', (Image.new('L', roughness.size, 255), roughness, metalness))
packed.save(output / 'metallic-roughness-1024.webp', lossless=True, method=6)

manifest = {
    'method': 'Original base colour at native resolution, WebP quality 94. Original scalar G/B maps resized with Lanczos, packed G=roughness B=metalness, lossless WebP. No artistic changes.',
    'sources': [{'file': str(path.relative_to(root)).replace('\\', '/'), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in [base_path, roughness_path, metalness_path]],
    'outputs': [{'file': path.name, 'bytes': path.stat().st_size, 'size': list(Image.open(path).size), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(output.glob('*.webp'))],
}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest['outputs'], indent=2))
