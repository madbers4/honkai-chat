import * as THREE from 'three';
function seededRandom(seed = 42) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTexture(width, height, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  return texture;
}

export function makeLegacyFloorTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const random = seededRandom(710);
    ctx.fillStyle = '#333b40';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const shade = Math.floor(45 + random() * 13);
        ctx.fillStyle = `rgb(${shade},${shade + 7},${shade + 10})`;
        ctx.fillRect(x * 256 + 3, y * 256 + 3, 249, 249);
        ctx.strokeStyle = 'rgba(157,167,173,0.1)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * 256 + 5, y * 256 + 5, 244, 244);
      }
    }
    for (let i = 0; i < 36000; i++) {
      const alpha = random() * 0.13;
      ctx.fillStyle = random() > 0.5 ? `rgba(205,212,211,${alpha})` : `rgba(0,5,9,${alpha})`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 4, 1 + random() * 3);
    }
    for (let i = 0; i < 130; i++) {
      const x = random() * w, y = random() * h;
      ctx.strokeStyle = `rgba(187,178,153,${random() * 0.08})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random() * 60, y + random() * 9); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = random() * w, y = random() * h, radius = 40 + random() * 120;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(5,13,17,0.2)'); gradient.addColorStop(1, 'rgba(5,13,17,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }, [3, 2]);
}

