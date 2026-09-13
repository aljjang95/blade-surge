import { PARTY_VISUAL_LIMIT, validPartyVisual } from './visual-protocol.js';
// The host simulates combat. The relay validates membership, lifecycle and bounded data,
// not damage correctness. No competitive/account reward authority is implied.
export const PARTY_HEROES = Object.freeze(['knight', 'barbarian', 'mage', 'rogue', 'ranger']);
export const PARTY_LIMITS = Object.freeze({ members: 4, ttlMs: 45 * 60 * 1000, bytes: 65536,
  messagesPerSecond: 40, bytesPerSecond: 768 * 1024, snapshotsPerSecond: 10, inputsPerSecond: 20,
  enemies: 180, rooms: 64, projectiles: 160, events: 32, warnings: 48 });
export const PARTY_CODE = /^[A-F0-9]{20}$/;
export const PARTY_ACTIONS = Object.freeze(['skill0', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'dodge']);
export function sanitizePartyName(value) {
  return String(value ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20) || '모험가';
}
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, min = -4096, max = 4096) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int = (v, min = 0, max = 2147483647) => Number.isInteger(v) && num(v, min, max);
const str = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w .:-]+$/.test(v);
const bool = v => typeof v === 'boolean';
const array = (v, max, valid) => Array.isArray(v) && v.length <= max && v.every(valid);
const unique = (values) => new Set(values).size === values.length;
const keys = (v, allowed) => Object.keys(v).every(k => allowed.includes(k));
const coord = v => obj(v) && num(v.x) && num(v.z);
const actor = v => coord(v) && str(v.id) && num(v.yaw, -100, 100)
  && num(v.hp, 0, 1e9) && num(v.maxHp, 1, 1e9) && v.hp <= v.maxHp
  && str(v.state, 40) && (v.anim === null || str(v.anim, 80));
const warning = v => obj(v) && str(v.id, 96) && ['disk', 'ring', 'lane'].includes(v.kind)
  && num(v.x, -2000, 2000) && num(v.z, -2000, 2000)
  && ['radius', 'width', 'length', 'safeRadius'].every(k => num(v[k], 0, 80))
  && num(v.angle, -100, 100) && num(v.remaining, 0, 20) && num(v.duration, 0.01, 20)
  && int(v.color, 0, 0xffffff)
  && keys(v, ['id','kind','x','z','radius','width','length','angle','safeRadius','remaining','duration','color']);
export function validPartyInput(v) {
  return obj(v) && int(v.seq) && num(v.x, -1, 1) && num(v.y, -1, 1) && bool(v.attack)
    && array(v.actions, 7, a => PARTY_ACTIONS.includes(a)) && unique(v.actions);
}
export function validPartySnapshot(v) {
  return obj(v) && keys(v, ['tick','elapsed','players','enemies','rooms','roomsCleared','bossDefeated','portal','events','projectiles','paused','warnings','visuals'])
    && (v.paused === undefined || bool(v.paused))
    && (v.visuals === undefined || array(v.visuals, PARTY_VISUAL_LIMIT, effect => validPartyVisual(effect) && effect.at <= v.elapsed))
    && (v.warnings === undefined || (array(v.warnings, PARTY_LIMITS.warnings, warning) && unique(v.warnings.map(w => w.id))))
    && int(v.tick) && num(v.elapsed, 0, 3600)
    && array(v.players, 4, p => actor(p) && PARTY_HEROES.includes(p.heroId) && num(p.ult, 0, 1000)
      && keys(p, ['id','heroId','x','z','yaw','hp','maxHp','state','anim','ult','cds'])
      && array(p.cds, 12, cd => num(cd, 0, 3600))) && v.players.length >= 2 && unique(v.players.map(p => p.id))
    && array(v.enemies, PARTY_LIMITS.enemies, e => actor(e) && str(e.key) && bool(e.boss) && bool(e.elite)
      && keys(e, ['id','key','x','z','yaw','hp','maxHp','state','anim','boss','elite']))
    && unique(v.enemies.map(e => e.id))
    && array(v.rooms, PARTY_LIMITS.rooms, r => obj(r) && (str(r.id) || int(r.id, 0, 64))
      && bool(r.discovered) && bool(r.cleared) && bool(r.activated)
      && keys(r, ['id','discovered','cleared','activated'])) && unique(v.rooms.map(r => r.id))
    && int(v.roomsCleared, 0, 64) && bool(v.bossDefeated) && (v.portal === null || (coord(v.portal) && keys(v.portal, ['x','z'])))
    && array(v.events, PARTY_LIMITS.events, e => obj(e) && str(e.type, 32)
      && (e.x === undefined || num(e.x)) && (e.z === undefined || num(e.z))
      && Object.keys(e).every(k => ['type', 'x', 'z', 'id', 'value'].includes(k))
      && (e.id === undefined || str(e.id)) && (e.value === undefined || num(e.value, 0, 1e9)))
    && (v.projectiles === undefined || array(v.projectiles, PARTY_LIMITS.projectiles,
      p => coord(p) && str(p.id) && num(p.y ?? 0) && num(p.yaw ?? 0, -100, 100)
        && keys(p, ['id','x','y','z','yaw'])));
}
export function validPartyStats(v) {
  return obj(v) && num(v.elapsed, 0, 3600) && int(v.kills, 0, 100000) && int(v.roomsCleared, 0, 64)
    && Object.keys(v).every(k => ['elapsed', 'kills', 'roomsCleared'].includes(k));
}
