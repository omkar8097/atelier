/**
 * color-utils.js — 100% Offline Image Intelligence for Poshak
 * Provides k-means dominant color extraction, Sobel pattern detection,
 * and offline category / title / description auto-fill.
 */

(function () {

  // Convert RGB to HEX
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  // Convert RGB to HSL
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return { h, s, l };
  }

  // Euclidean distance between two RGB triples
  function colorDist(c1, c2) {
    return Math.sqrt(
      (c1[0] - c2[0]) ** 2 +
      (c1[1] - c2[1]) ** 2 +
      (c1[2] - c2[2]) ** 2
    );
  }

  /**
   * 1. Dominant Color Extraction via K-Means++
   */
  function extractDominantColors(canvas, opts = {}) {
    const k = opts.k || 3;
    const bgThreshold = opts.bgThreshold || 18;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return [{ hex: '#5b6b8c', weight: 1, rgb: [91, 107, 140] }];

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // --- Background Ring Exclusion ---
    let ringR = 0, ringG = 0, ringB = 0, ringCount = 0;
    const ringWidth = Math.min(6, Math.floor(Math.min(w, h) / 4));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < ringWidth || x >= w - ringWidth || y < ringWidth || y >= h - ringWidth) {
          const idx = (y * w + x) * 4;
          if (data[idx + 3] > 128) {
            ringR += data[idx];
            ringG += data[idx + 1];
            ringB += data[idx + 2];
            ringCount++;
          }
        }
      }
    }

    const ringMean = ringCount > 0
      ? [ringR / ringCount, ringG / ringCount, ringB / ringCount]
      : [255, 255, 255];

    // Collect candidate pixels (sampling every 4th pixel for speed)
    const allPixels = [];
    const fgPixels = [];

    for (let i = 0; i < data.length; i += 16) {
      const a = data[i + 3];
      if (a < 128) continue;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      allPixels.push(rgb);
      if (colorDist(rgb, ringMean) > bgThreshold) {
        fgPixels.push(rgb);
      }
    }

    // Fall back to all pixels if background exclusion removed > 70% of points
    const points = (fgPixels.length >= allPixels.length * 0.3 && fgPixels.length > 20)
      ? fgPixels
      : allPixels;

    if (points.length === 0) {
      return [{ hex: '#5b6b8c', weight: 1, rgb: [91, 107, 140] }];
    }

    // --- K-Means++ Initialization ---
    const centroids = [points[Math.floor(Math.random() * points.length)]];
    while (centroids.length < k && centroids.length < points.length) {
      const dists = points.map(p => {
        let minDist = Infinity;
        for (const c of centroids) {
          const d = colorDist(p, c);
          if (d < minDist) minDist = d;
        }
        return minDist ** 2;
      });

      const totalDist = dists.reduce((a, b) => a + b, 0);
      let rand = Math.random() * totalDist;
      let chosen = points[0];
      for (let i = 0; i < points.length; i++) {
        rand -= dists[i];
        if (rand <= 0) { chosen = points[i]; break; }
      }
      centroids.push(chosen);
    }

    // --- Lloyd's Algorithm Iterations ---
    let assignments = new Array(points.length).fill(0);
    const maxIter = 10;

    for (let iter = 0; iter < maxIter; iter++) {
      let moved = false;
      const sums = centroids.map(() => [0, 0, 0]);
      const counts = centroids.map(() => 0);

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let minDist = Infinity, bestC = 0;
        for (let c = 0; c < centroids.length; c++) {
          const d = colorDist(p, centroids[c]);
          if (d < minDist) { minDist = d; bestC = c; }
        }
        if (assignments[i] !== bestC) { assignments[i] = bestC; moved = true; }
        sums[bestC][0] += p[0];
        sums[bestC][1] += p[1];
        sums[bestC][2] += p[2];
        counts[bestC]++;
      }

      for (let c = 0; c < centroids.length; c++) {
        if (counts[c] > 0) {
          centroids[c] = [
            sums[c][0] / counts[c],
            sums[c][1] / counts[c],
            sums[c][2] / counts[c]
          ];
        }
      }

      if (!moved) break;
    }

    // --- Score & Rank Clusters ---
    const clusters = centroids.map((c, idx) => {
      const count = assignments.filter(a => a === idx).length;
      const hsl = rgbToHsl(c[0], c[1], c[2]);
      const saturationBoost = 1 + (hsl.s * 0.7);
      return {
        rgb: c.map(Math.round),
        hex: rgbToHex(c[0], c[1], c[2]),
        hsl,
        weight: count * saturationBoost
      };
    });

    clusters.sort((a, b) => b.weight - a.weight);
    return clusters;
  }

  /**
   * 2. Pattern Auto-Detection via Sobel Gradients & Periodicity
   */
  function detectPattern(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return { pattern: 'Solid', confidence: 0.8 };

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Convert to grayscale grid
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        gray[y * w + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }
    }

    // 3x3 Sobel gradients
    const rowGrads = new Float32Array(h);
    const colGrads = new Float32Array(w);
    let totalEdgeEnergy = 0;
    let edgeCount = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx = (gray[(y - 1) * w + (x + 1)] + 2 * gray[y * w + (x + 1)] + gray[(y + 1) * w + (x + 1)]) -
                   (gray[(y - 1) * w + (x - 1)] + 2 * gray[y * w + (x - 1)] + gray[(y + 1) * w + (x - 1)]);
        const gy = (gray[(x - 1) + (y + 1) * w] + 2 * gray[x + (y + 1) * w] + gray[(x + 1) + (y + 1) * w]) -
                   (gray[(x - 1) + (y - 1) * w] + 2 * gray[x + (y - 1) * w] + gray[(x + 1) + (y - 1) * w]);
        const mag = Math.sqrt(gx * gx + gy * gy);
        totalEdgeEnergy += mag;
        edgeCount++;
        rowGrads[y] += Math.abs(gy);
        colGrads[x] += Math.abs(gx);
      }
    }

    const avgEdgeEnergy = edgeCount > 0 ? totalEdgeEnergy / edgeCount : 0;

    // Directional Variances
    const rowMean = rowGrads.reduce((a, b) => a + b, 0) / h;
    const colMean = colGrads.reduce((a, b) => a + b, 0) / w;
    const rowVar = rowGrads.reduce((a, b) => a + (b - rowMean) ** 2, 0) / h;
    const colVar = colGrads.reduce((a, b) => a + (b - colMean) ** 2, 0) / w;

    // Threshold classification
    if (avgEdgeEnergy < 12) {
      return { pattern: 'Solid', confidence: 0.88 };
    }

    const varRatio = rowVar > 0 ? colVar / rowVar : 1;

    if (varRatio > 2.2 || varRatio < 0.45) {
      return { pattern: 'Striped', confidence: 0.76 };
    }

    if (avgEdgeEnergy > 38 && Math.abs(varRatio - 1) < 0.5) {
      return { pattern: 'Plaid', confidence: 0.72 };
    }

    if (avgEdgeEnergy > 24) {
      return { pattern: 'Floral', confidence: 0.65 };
    }

    return { pattern: 'Textured', confidence: 0.60 };
  }

  /**
   * 3. 100% Offline Category & Smart Title/Description Auto-Fill
   */
  function detectCategoryAndSmartFill(canvas, colorInfo, patternInfo) {
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    const aspectRatio = w / h;

    const primaryHex = colorInfo && colorInfo[0] ? colorInfo[0].hex : '#5b6b8c';
    const hsl = colorInfo && colorInfo[0] ? colorInfo[0].hsl : { h: 210, s: 0.3, l: 0.5 };
    const pattern = patternInfo ? patternInfo.pattern : 'Solid';

    let category = 'Casual Shirt';

    // Heuristic Category Classification
    if (hsl.h >= 190 && hsl.h <= 240 && hsl.s > 0.25 && hsl.l < 0.45) {
      category = aspectRatio < 0.85 ? 'Jeans' : 'Formal Trousers';
    } else if (hsl.h >= 30 && hsl.h <= 55 && hsl.s > 0.2 && hsl.l < 0.6) {
      category = 'Chinos';
    } else if ((hsl.h >= 340 || hsl.h <= 25) && hsl.s > 0.3) {
      category = 'Kurta';
    } else if (pattern === 'Plaid' || pattern === 'Striped') {
      category = 'Casual Shirt';
    } else if (pattern === 'Textured') {
      category = 'Jacket / Blazer / Coat';
    } else if (aspectRatio > 1.2) {
      category = 'Watch / Belt / Sunglasses';
    } else if (aspectRatio < 0.75) {
      category = 'Dress / One-Piece';
    } else if (hsl.l > 0.85) {
      category = 'T-Shirt / Polo';
    }

    // Color Name Descriptor
    let colorName = 'Classic';
    const hDeg = hsl.h, s = hsl.s, l = hsl.l;
    if (l < 0.15) colorName = 'Black';
    else if (l > 0.85) colorName = 'White';
    else if (s < 0.15) colorName = l > 0.5 ? 'Light Grey' : 'Charcoal';
    else if (hDeg >= 345 || hDeg < 15) colorName = 'Crimson';
    else if (hDeg >= 15 && hDeg < 45) colorName = l > 0.6 ? 'Beige / Tan' : 'Brown';
    else if (hDeg >= 45 && hDeg < 70) colorName = 'Gold / Mustard';
    else if (hDeg >= 70 && hDeg < 165) colorName = 'Emerald / Olive';
    else if (hDeg >= 165 && hDeg < 260) colorName = l < 0.35 ? 'Navy' : 'Blue';
    else if (hDeg >= 260 && hDeg < 310) colorName = 'Plum / Purple';
    else colorName = 'Rose / Pink';

    const title = `${colorName} ${pattern !== 'Solid' ? pattern + ' ' : ''}${category.split('/')[0].trim()}`;
    const description = `Tailored ${colorName.toLowerCase()} tone in a ${pattern.toLowerCase()} finish, ideal for versatile pairing.`;

    return {
      category,
      title,
      description,
      hex: primaryHex,
      pattern
    };
  }

  // Expose global interface
  window.PoshakColorUtils = {
    extractDominantColors,
    detectPattern,
    detectCategoryAndSmartFill,
    rgbToHex,
    rgbToHsl
  };

})();
