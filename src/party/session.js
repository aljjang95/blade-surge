import * as THREE from 'three';
import { HEROES, heroStats } from '../data/heroes.js';
import { ENEMIES, stageDef, STAGES_PER_CHAPTER, CHAPTERS } from '../data/stages.js';
import { Player } from '../game/player.js';
import { Enemy } from '../game/enemies.js';
import { loadModel, disposeCharacter } from '../engine/assets.js';
import { audio } from '../engine/audio.js';
import { PARTY_CODE, PARTY_ACTIONS, sanitizePartyName, validPartySnapshot } from './protocol.js';
import { RemoteInput, actorSnapshot, partyHeroState, normalizedPartyStats, canonicalPartyCode } from './replication.js';
import { PartyView } from './view.js';
import { capturePartyWarnings, PartyCombatEffects } from './combat-effects.js';
import { queuePartyVisual } from './visual-protocol.js';
import { capturePartyEffects, PartyVisualPlayer } from './visual-effects.js';

const ERRORS = { 'not-ready':'모두 준비를 마쳐야 출격할 수 있습니다.', 'not-host':'방장만 출격할 수 있습니다.',
  'full':'파티가 가득 찼습니다.', 'running':'이미 출격한 파티입니다.', 'expired':'초대가 만료됐습니다. 새 파티를 만들어 주세요.',
  'rate-limit':'잠시 후 다시 시도해 주세요.', 'not-found':'파티를 찾지 못했습니다. 초대 코드를 확인해 주세요.' };
export class PartySession {
  constructor(app) {
    this.app = app; this.players = new Map(); this.inputs = new Map(); this.replicas = new Map(); this.events = [];
    this.name = sanitizePartyName(app.eco.s.name); this.stageIdx = 1; this.party = null; this.run = null; this.members = [];
    this.heroId = app.eco.s.selected;
    this.inviteCode = canonicalPartyCode(new URL(location.href).searchParams.get('party'));
    this.view = new PartyView(this); this.generation = 0; this.actorSeq = 0;
    this._health = setInterval(() => {
      if (this.run && !this.finishing && performance.now() - this.lastMessage > 12000) this.abort('연결 응답이 없습니다. 원정을 종료했습니다.');
    }, 2000);
    window.addEventListener('pagehide', () => this.socket?.close(1000, 'page left'));
    if (PARTY_CODE.test(this.inviteCode)) this.view.open();
  }
  get isHost() { return !!this.playerId && this.party?.hostId === this.playerId; }
  send(message) { if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 128 * 1024) { this.socket.send(JSON.stringify(message)); return true; } return false; }
  inviteUrl() { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('party', this.party.code); return url.href; }
  async create() {
    if (this.connecting || this.app.stageStarting || this.app.mode !== 'lobby') return;
    this.connecting = true; this.view.message('파티를 만들고 있습니다.'); this.view.render();
    try {
      const response = await fetch('/api/party', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', signal:AbortSignal.timeout(10000) });
      const data = await response.json(); if (!response.ok) throw new Error(ERRORS[data.error] || '파티 서버에 연결하지 못했습니다.');
      await this.connect(data.code, data.hostTicket);
    } catch (e) { this.view.message(e.message); }
    finally { this.connecting = false; this.view.render(); }
  }
  async join(code) {
    if (this.connecting || this.app.stageStarting || this.app.mode !== 'lobby') return;
    code = canonicalPartyCode(code);
    if (!PARTY_CODE.test(code)) { this.view.message('초대 링크 또는 20자리 초대 코드를 확인해 주세요.'); return; }
    this.connecting = true; this.view.render(); this.view.message('파티에 연결하고 있습니다.');
    try { await this.connect(code); } catch (e) { this.view.message(e.message); }
    finally { this.connecting = false; this.view.render(); }
  }
  connect(code, ticket) {
    const generation = ++this.generation; this.socket?.close();
    this.playerId = null; this.party = null; this.name = sanitizePartyName(this.name);
    const url = new URL(`/api/party/${code}`, location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', this.name); url.searchParams.set('hero', this.heroId);
    url.searchParams.set('visuals', '1');
    if (ticket) url.searchParams.set('ticket', ticket);
    const socket = this.socket = new WebSocket(url); this.lastMessage = performance.now();
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const timeout = setTimeout(() => { socket.close(); reject(new Error('파티 연결 시간이 초과됐습니다.')); }, 10000);
      socket.addEventListener('message', e => {
        if (generation !== this.generation) return;
        this.lastMessage = performance.now();
        let message; try { message = JSON.parse(e.data); } catch { return; }
        if (message.type === 'welcome') { welcomed = true; clearTimeout(timeout); resolve(); }
        this.receive(message);
      });
      socket.addEventListener('close', () => {
        clearTimeout(timeout); if (generation !== this.generation) return;
        if (!welcomed) reject(new Error('파티에 참가하지 못했습니다. 코드·인원·출격 여부를 확인해 주세요.'));
        else if (this.run && !this.finishing) this.abort('파티 연결이 끊겼습니다. 다시 파티를 만들어 주세요.');
        else if (!this.finishing) { this.party = null; this.view.render(); this.view.message('파티 연결이 종료됐습니다.'); }
      });
      socket.addEventListener('error', () => { clearTimeout(timeout); if (!welcomed) reject(new Error('파티 서버에 연결하지 못했습니다.')); });
    });
  }
  receive(message) {
    if (message.type === 'welcome') { this.playerId = message.playerId; this.party = message.party; this.stageIdx = message.party.stageIdx ?? 1; this.view.message('연결됐습니다. 준비를 마친 뒤 함께 출격하세요.'); this.view.render(); }
    else if (message.type === 'party') { this.party = message.party; this.stageIdx = message.party.stageIdx ?? this.stageIdx; if (!this.finishing) this.view.render(); }
    else if (message.type === 'start') { void this.begin(message.run, message.members); }
    else if (message.type === 'input' && this.isHost && this.run) {
      const input = this.inputs.get(message.playerId); if (input) { input.receive(message, performance.now()); this.loaded.add(message.playerId); }
    } else if (message.type === 'snapshot' && !this.isHost && this.run && validPartySnapshot(message.snapshot)) {
      if (message.seq <= (this.snapshotSeq ?? -1)) return; this.snapshotSeq = message.seq; this.snapshot = message.snapshot;
      this.pendingEvents.push(...message.snapshot.events); this.pendingEvents = this.pendingEvents.slice(-64);
      for (const visual of message.snapshot.visuals || []) queuePartyVisual(this.pendingVisuals,visual);
    } else if (message.type === 'finish' && this.run?.runId === message.runId) this.complete(message.win, message.stats);
    else if (message.type === 'abort') this.abort('파티원이 연결을 종료해 원정을 마쳤습니다.');
    else if (message.type === 'error') this.view.message(ERRORS[message.error] || '요청을 처리하지 못했습니다. 준비 상태를 확인해 주세요.');
  }
  start() {
    if (!this.isHost || this.party?.status !== 'lobby') return;
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1;
    this.send({ type:'start', stageIdx:this.stageIdx, seed });
  }
  async begin(run, members) {
    if (this.run || !Number.isInteger(run.stageIdx) || run.stageIdx < 1 || run.stageIdx > CHAPTERS.length * STAGES_PER_CHAPTER) return;
    this.run = run; this.members = members; this.finishing = false; this.finishSent = false; this.snapshot = null; this.snapshotSeq = -1;
    this.seq = 0; this.tick = 0; this.sendT = 0; this.hudT = 0; this.events = []; this.pendingEvents = []; this.loaded = new Set();
    this.visuals=[]; this.pendingVisuals=[];
    this.loadStarted = performance.now(); this.lastMessage = performance.now(); this.view.dialog.close();
    const app = this.app; app.stageStarting = true;
    try {
      app.ui.hideResult(); app.ui.closeModal(); app.journeyView?.close(); app.arsenalView?.close(); app.ui.show(document.getElementById('meta'), false);
      document.getElementById('stage-loading').hidden = false;
      if (app.showcase) { disposeCharacter(app.showcase.root, app.showcase.mixer); app.showcase = null; }
      const ch = Math.ceil(run.stageIdx / STAGES_PER_CHAPTER), st = (run.stageIdx - 1) % STAGES_PER_CHAPTER + 1;
      const stage = { ...stageDef(ch, st), party:{runId:run.runId,seed:run.seed} };
      const me = members.find(m => m.id === this.playerId); if (!me) throw new Error('party member missing');
      app.mode = 'battle'; document.body.classList.add('party-playing'); await app.battle.start(stage, me.heroId, partyHeroState(), {});
      if (!this.run || this.finishing) { app.battle.stop(); return; }
      app.battle.player.auto = false; document.getElementById('btn-auto').classList.remove('on');
      app.battle.chronicle.hud.hidden = true; app.battle.rpgView.hudButton.hidden = true;
      this.loaded.add(this.playerId); this.ready = true;
      if (this.isHost) app.battle.setPaused('party-loading', true);
      this.view.updateHud();
      app.ui.toast(this.isHost ? '파티원들의 던전 입장을 기다립니다.' : '파티 던전 입장 · 함께 길을 여세요.', 'gold');
    } catch (error) { console.warn('party start failed', error.message); this.abort('던전을 준비하지 못했습니다. 새 파티에서 다시 시도해 주세요.'); this.socket?.close(); }
    finally { app.stageStarting = false; document.getElementById('stage-loading').hidden = true; }
  }
  async prepareActors(battle) {
    const start = battle.world.startRoom;
    for (let i = 0; i < this.members.length; i++) {
      const member = this.members[i], def = HEROES[member.heroId];
      const input = new RemoteInput(); this.inputs.set(member.id, input);
      let player;
      if (member.id === this.playerId) player = battle.player;
      else {
        const proxy = new Proxy(battle, {get:(target, key) => key === 'player' ? player : key === 'input' ? input : key === 'onPlayerDeath' ? p => this.playerDown(p) : Reflect.get(target, key), set:(target,key,value)=>Reflect.set(target,key,value)});
        player = new Player(proxy, await loadModel(def.model), def, heroStats(def, partyHeroState(), {}), [1,1,1,1,1,1], {}, 20);
      }
      player.partyId = member.id; player.stats = normalizedPartyStats(heroStats(def, partyHeroState(), {}), battle.stage.scale);
      player.maxHp = player.hp = player.stats.hp; player.heroLevel = 20; player.auto = false;
      player.pos.set(start.x + (i % 2) * 1.5, 0, start.z + Math.floor(i / 2) * 1.5);
      this.players.set(member.id, player);
    }
    battle.buildBase = { ...battle.player.stats }; battle.appliedStats = battle.player.stats;
    battle.ui.setupHud(battle.player.def, battle.player);
    if (this.isHost) {
      this.originalFx=battle.fx;
      this.capturedFx=battle.fx=capturePartyEffects(battle.fx,visual=>{
        if (battle.active && !this.finishing) queuePartyVisual(this.visuals,visual);
      },()=>battle.elapsed);
    } else this.visualPlayer=new PartyVisualPlayer(battle.fx);
    // Guest replicas do not simulate hazards, NPC allies, loot or combat timers.
    if (!this.isHost) { battle.hazards?.dispose(); battle.hazards = null; battle.timers.length = 0; this.combatEffects = new PartyCombatEffects(this.app.scene); }
  }
  livingPlayers() { return [...this.players.values()].filter(p => p.alive); }
  nearestPlayer(pos) { let best = null, distance = Infinity; for (const p of this.players.values()) if (p.alive) { const d = p.pos.distanceToSquared(pos); if (d < distance) { distance = d; best = p; } } return best || this.app.battle.player; }
  attachEnemy(enemy, key) {
    enemy.partyId = 'e' + (++this.actorSeq); enemy.speciesId = key;
    const battle = this.app.battle;
    enemy.game = new Proxy(battle, { get:(target, prop) => prop === 'player' ? this.nearestPlayer(enemy.pos) : Reflect.get(target, prop), set:(target,prop,value)=>Reflect.set(target,prop,value) });
    const multiplier = 1 + .65 * (this.members.length - 1); enemy.maxHp = enemy.hp = Math.round(enemy.maxHp * multiplier);
  }
  updateHostActors(dt) {
    if (!this.isHost || !this.run) return;
    const b = this.app.battle, now = performance.now();
    for (const [id, player] of this.players) {
      if (player === b.player) continue;
      const input = this.inputs.get(id); input.expire(now); if (b.active) player.handleInput(input, dt); player.update(dt);
      if (player.alive && b.active) {
        const room = b.world.roomAt(player.pos.x, player.pos.z); if (room) { room.discovered = true; if (!room.spawned && !room.cleared) b.enterRoom(room); }
        if (b.portal?.t > .8 && player.pos.distanceTo(b.portal.pos) < 1.4) { player.pos.copy(b.portal.exit); player.vel.set(0,0,0); player.kb.set(0,0,0); player.invuln = Math.max(player.invuln,1); player.partyPortaled=true; }
      }
    }
  }
  playerDown(player) {
    if (!this.isHost || this.finishing) return;
    if (!this.livingPlayers().length) { this.finish(false); return; }
    this.app.ui.toast('쓰러진 동료가 5초 뒤 생존 파티원에게 합류합니다.', 'gold');
    this.app.battle.after(5, () => {
      if (!this.run || this.finishing || player.alive) return;
      const ally = this.livingPlayers()[0]; if (!ally) return;
      player.revive(); player.hp = Math.round(player.maxHp * .5); player.pos.copy(ally.pos); player.invuln = 3;
      if (player === this.app.battle.player) this.app.input.enabled = !this.app.battle.paused;
    });
  }
  hitEvent(enemy, value) { if (this.events.length < 32) this.events.push({type:'hit',id:enemy.partyId,x:enemy.pos.x,z:enemy.pos.z,value:Math.round(value)}); }
  snapshotOf() {
    const b = this.app.battle;
    return { tick:++this.tick,elapsed:b.elapsed,paused:b.paused,warnings:capturePartyWarnings(b),visuals:this.visuals.splice(0),
      players:this.members.map(m => { const p = this.players.get(m.id); return {...actorSnapshot(p,m.id),heroId:m.heroId,ult:p.ult,cds:p.cds.map(v => Math.max(0,v))}; }),
      enemies:b.enemies.filter(e => e.partyId).slice(0,180).map(e => ({...actorSnapshot(e,e.partyId),key:e.speciesId,boss:e.isBoss,elite:e.isElite})),
      rooms:b.world.rooms.map((r,i) => ({id:i,discovered:!!r.discovered,cleared:!!r.cleared,activated:!!r.spawned})), roomsCleared:b.roomsCleared,
      bossDefeated:!!b.bossDefeated,portal:b.portal ? {x:b.portal.pos.x,z:b.portal.pos.z} : null,events:this.events.splice(0),
      projectiles:b.projectiles.slice(0,160).map((p,i)=>({id:'p'+i,x:p.pos.x,y:p.pos.y,z:p.pos.z,yaw:Math.atan2(p.dir.x,p.dir.z)})) };
  }
  update(dt) {
    if (!this.run || !this.ready || this.finishing) return;
    const b = this.app.battle; this.hudT += dt;
    if (this.isHost) {
      // Inputs act as the guest's loaded acknowledgement; no world clock advances early.
      if (b.pauseReasons.has('party-loading')) {
        if (this.loaded.size === this.members.length) { b.setPaused('party-loading',false); this.app.ui.toast('모두 입장했습니다. 함께 출격!', 'gold'); }
        else if (performance.now() - this.loadStarted > 25000) { this.abort('파티원 입장 시간이 초과됐습니다.'); this.socket?.close(); return; }
      }
      // Incoming guest inputs keep the host connection alive too.
      this.sendT += dt;
      if (this.sendT >= .12) { this.sendT = 0; this.send({type:'snapshot',seq:++this.seq,snapshot:this.snapshotOf()}); }
    }
    if (this.hudT > .2) { this.hudT = 0; this.view.updateHud(); }
  }
  updateGuest(dt) {
    if (!this.run || !this.ready || this.finishing) return;
    const b = this.app.battle, input = this.app.input;
    input.update(); this.sendT += dt;
    if (this.sendT >= .06) {
      this.sendT = 0; const paused = b.paused || document.hidden || this.snapshot?.paused;
      const attack = input.attackHeld || input.consume('attack');
      const actions = input.queue.splice(0).filter(a => PARTY_ACTIONS.includes(a));
      this.send({type:'input',seq:++this.seq,x:paused?0:input.move.x,y:paused?0:input.move.y,attack:!paused&&attack,actions:paused?[]:actions});
    }
    const state = this.snapshot; if (!state) return;
    b.elapsed = state.elapsed; b.roomsCleared = state.roomsCleared; b.bossDefeated = state.bossDefeated;
    for (const room of state.rooms) { const local = b.world.rooms[room.id]; if (local) Object.assign(local,{discovered:room.discovered,cleared:room.cleared,spawned:room.activated}); }
    if ((state.portal || state.bossDefeated) && b.world.sealed) { b.world.unseal(); b.arena.openSeal(b.fx); }
    for (const member of state.players) { const p = this.players.get(member.id); if (p) { this.applyPose(p,member,dt); p.ult=member.ult; p.cds=member.cds; } }
    const ids = new Set();
    for (const item of state.enemies) {
      ids.add(item.id); let enemy = this.replicas.get(item.id);
      if (!enemy) {
        const def = ENEMIES[item.key]; if (!def || !this.app.models[def.model]) continue;
        enemy = new Enemy(b,this.app.models[def.model],b.weaponsGltf,def,1,new THREE.Vector3(item.x,0,item.z));
        enemy.partyId=item.id; enemy.speciesId=item.key; enemy.spawning=false; this.replicas.set(item.id,enemy);
      }
      this.applyPose(enemy,item,dt);
    }
    for (const [id, enemy] of this.replicas) if (!ids.has(id)) { enemy.dispose(); this.replicas.delete(id); }
    b.enemies = [...this.replicas.values()]; b.boss = b.enemies.find(e => e.isBoss && e.alive) || null;
    b.ui.showBoss(b.boss?.def.name || '',!!b.boss,b.boss?.def.portrait);
    this.renderProjectiles(state.projectiles || []);
    this.combatEffects?.update(state.warnings || []);
    this.visualPlayer?.update(dt);
    this.visualPlayer?.play(this.pendingVisuals.splice(0),state.elapsed,this.app.reducedMotion.matches);
    for (const event of this.pendingEvents.splice(0)) if (event.type === 'hit') {
      const pos = new THREE.Vector3(event.x,1,event.z), target = this.replicas.get(event.id);
      if (!this.app.reducedMotion.matches) { b.fx.flash(pos,0xffd080,{size:1.8,life:.12}); target?.flash(0xffffff); target?.receiveImpact(0,1,.5); }
      b.fx.damage(pos,event.value,{kind:'skill'});
      audio.hit('slash',{heavy:event.value>1000});
    }
    b.renderer.rig.target.lerp(b.player.pos,1-Math.exp(-dt*10)); b.arena.update(dt,b.fx,b.player.pos);
    b.ui.setObjective(b.world); b.ui.updateHud(b,dt);
  }
  applyPose(actor,state,dt) {
    if (!actor._replicated) { actor.pos.set(state.x,0,state.z); actor._replicated=true; }
    actor.pos.x += (state.x-actor.pos.x)*(1-Math.exp(-dt*22)); actor.pos.z += (state.z-actor.pos.z)*(1-Math.exp(-dt*22));
    actor.yaw = state.yaw; actor.hp = state.hp; actor.maxHp = state.maxHp; actor.alive = state.hp > 0; actor.state = state.state;
    if (state.anim && state.anim !== actor.actionName) actor.play(state.anim,{loop:['idle','move'].includes(state.state),fade:.06,once:!['idle','move'].includes(state.state)});
    actor.root.rotation.y=state.yaw+(actor.rig.faceFlip?Math.PI:0); actor.mixer.update(dt); actor.updateCombatPose(dt);
    if (actor.flashT > 0) { actor.flashT = Math.max(0,actor.flashT-dt); for (const m of actor.mats) { m.emissive.copy(actor.flashColor).multiplyScalar(actor.flashT*10); if(m.userData.baseEmissive)m.emissive.add(m.userData.baseEmissive); } actor._emDirty=true; }
    else if(actor._emDirty) { actor._emDirty=false; for(const m of actor.mats) { if(m.userData.baseEmissive)m.emissive.copy(m.userData.baseEmissive);else m.emissive.setScalar(0); } }
  }
  renderProjectiles(projectiles) {
    if (!this.orbMesh) {
      this.orbGeo = new THREE.SphereGeometry(.22,6,4); this.orbMat = new THREE.MeshBasicMaterial({color:0x8bddff});
      this.orbMesh = new THREE.InstancedMesh(this.orbGeo,this.orbMat,160); this.orbMesh.frustumCulled=false; this.orbMatrix=new THREE.Matrix4(); this.app.scene.add(this.orbMesh);
    }
    this.orbMesh.count=Math.min(160,projectiles.length);
    for(let i=0;i<this.orbMesh.count;i++){const p=projectiles[i];this.orbMatrix.makeTranslation(p.x,p.y??.8,p.z);this.orbMesh.setMatrixAt(i,this.orbMatrix);}
    this.orbMesh.instanceMatrix.needsUpdate=true;
  }
  finish(win) {
    if (!this.isHost || this.finishSent || !this.run) return; this.finishSent = true;
    const b = this.app.battle; b.active=false; this.app.input.enabled=false; this.app.input.clear();
    this.send({type:'snapshot',seq:++this.seq,snapshot:this.snapshotOf()});
    this.send({type:'finish',runId:this.run.runId,win,stats:{elapsed:b.elapsed,kills:b.kills,roomsCleared:b.roomsCleared}});
  }
  complete(win,stats) {
    if (this.finishing) return; this.finishing=true;
    const b=this.app.battle;b.active=false;b.setPaused('party-finished',true);this.app.input.enabled=false;this.app.input.clear();b.chronicle.close();
    audio.play(win?'jingle_win0':'ui_error');this.view.result(win,stats);
  }
  abort(reason) {
    if (this.finishing) return; this.finishing=true; this.ready=false;
    if (this.app.mode==='battle') {this.app.battle.active=false;this.app.battle.setPaused('party-finished',true);this.app.input.enabled=false;this.app.input.clear();}
    this.socket?.close();this.view.result(false,{elapsed:0,kills:0,roomsCleared:0},reason);
  }
  disposeActors() {
    for(const p of this.players.values()) if(p!==this.app.battle?.player)p.dispose();
    for(const e of this.replicas.values())e.dispose();
    this.orbMesh?.removeFromParent();this.orbMesh?.dispose();this.orbGeo?.dispose();this.orbMat?.dispose();this.orbMesh=null;
    this.combatEffects?.dispose();this.combatEffects=null;
    this.visualPlayer?.clear();this.visualPlayer=null;this.visuals=[];this.pendingVisuals=[];
    if (this.app.battle?.fx===this.capturedFx) this.app.battle.fx=this.originalFx;
    this.capturedFx=null;this.originalFx=null;
    const b = this.app.battle; if (b?.chronicle?.hud) b.chronicle.hud.hidden = false; if (b?.rpgView?.hudButton) b.rpgView.hudButton.hidden = false;
    this.players.clear();this.inputs.clear();this.replicas.clear();this.ready=false;
  }
  leave() {
    ++this.generation;this.socket?.close(1000,'left');this.socket=null;this.run=null;this.finishing=false;this.party=null;this.view.hud.hidden=true;
    document.body.classList.remove('party-playing');
    if(this.app.mode==='battle')this.app.toLobby();this.view.message('');this.view.render();
  }
}
