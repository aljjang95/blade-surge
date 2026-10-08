import assert from 'node:assert/strict';
import { buildRegionArchitecture } from '../../src/game/region-architecture.js';
import { architectureCases, architectureFingerprint, baseline, buildHistoricalArchitecture, historicalFloor } from './region-architecture-reference.mjs';

// 기준 JSON의 브라우저 계열 V8 해시도 유지한다. Bun 안에서 별도 Node 프로세스로 호출한다.
assert(process.versions.v8 && !process.versions.bun, 'Historical hash guard requires actual Node/V8');
const cases = {};
for (const [name, theme, makeFloor] of architectureCases) {
  const current = buildRegionArchitecture(historicalFloor(name, makeFloor), theme);
  const original = buildHistoricalArchitecture(historicalFloor(name, makeFloor), theme);
  try {
    const actual = architectureFingerprint(current), historical = architectureFingerprint(original), expected = baseline.cases[name];
    assert.equal(actual.geometrySha256, historical.geometrySha256, `${name}: ordered geometry bytes`);
    assert.equal(historical.metadataSha256, expected.metadataSha256, `${name}: historical metadata`);
    assert.equal(actual.metadataSha256, expected.metadataSha256, `${name}: current metadata`);
    // 함수 toString은 엔진마다 다르다. 기준 재질 해시는 Bun 본 테스트에서 그대로 검사한다.
    assert.equal(actual.materialsSha256, historical.materialsSha256, `${name}: same-runtime materials`);
    cases[name] = { ...actual, historicalGeometrySha256: historical.geometrySha256,
      archivedGeometrySha256: expected.geometrySha256, archivedGeometryMatches: historical.geometrySha256 === expected.geometrySha256 };
  } finally { current.userData.dispose(); original.userData.dispose(); }
}
console.log(JSON.stringify({ node: process.versions.node, v8: process.versions.v8, cases }));
