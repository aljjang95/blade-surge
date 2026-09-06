import * as THREE from 'three';
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function outline(root, y) {
  const points = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, ix = g.index, n = ix ? ix.count : g.attributes.position.count;
    for (let i = 0; i < n; i += 3) {
      const v = [0, 1, 2].map((k) => o.getVertexPosition(ix ? ix.getX(i + k) : i + k, new THREE.Vector3()).applyMatrix4(o.matrixWorld));
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        if ((a.y - y) * (b.y - y) <= 0 && Math.abs(a.y - b.y) > 1e-7) {
          const p = a.clone().lerp(b, (y - a.y) / (b.y - a.y)); points.push([p.x, p.z]);
        }
      }
    }
  });
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => { const h = []; for (const p of list) { while (h.length > 1 && cross([h.at(-1)[0] - h.at(-2)[0], h.at(-1)[1] - h.at(-2)[1]], [p[0] - h.at(-1)[0], p[1] - h.at(-1)[1]]) <= 0) h.pop(); h.push(p); } return h; };
  const low = half(points), high = half([...points].reverse()); low.pop(); high.pop(); const hull = low.concat(high);
  return Array.from({ length: 48 }, (_, i) => {
    const a = i * Math.PI * 2 / 48, d = [Math.sin(a), Math.cos(a)]; let distance = 0;
    for (let j = 0; j < hull.length; j++) {
      const p = hull[j], q = hull[(j + 1) % hull.length], s = [q[0] - p[0], q[1] - p[1]], den = cross(d, s);
      if (Math.abs(den) < 1e-9) continue;
      const t = cross(p, s) / den, u = cross(p, d) / den;
      if (t > 0 && u >= 0 && u <= 1) distance = Math.max(distance, t);
    }
    if (!distance) throw new Error('Missing head contour');
    return [Number((d[0] * distance).toFixed(6)), Number((d[1] * distance).toFixed(6))];
  });
}
export function sampleHeadProfiles(models) {
  return Object.fromEntries([['Knight', 2.16, .105], ['Barbarian', 2.075, .095], ['Mage', 2.065, .065]].map(([name, y, height]) => {
    const head = models[name].scene.getObjectByName(name + '_Head');
    return [name.toLowerCase(), { y, height, bottom: outline(head, y - height / 2), top: outline(head, y + height / 2) }];
  }));
}
