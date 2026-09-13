/** Inject before application boot. Observes native media calls without retaining
 * elements/nodes or deciding whether any network failure is acceptable. */
export function installConquestMediaObserver() {
  if (globalThis.__conquestMedia) return;
  const at = () => performance.timeOrigin + performance.now();
  const tracks = [], events = [], elements = new WeakMap(), sources = new WeakMap();
  const MAX_EVENTS = 4096;
  let droppedEvents = 0;
  const emit = event => {
    if (events.length === MAX_EVENTS) { events.shift(); droppedEvents++; }
    events.push(event);
  };
  const read = track => {
    const el = track.ref.deref();
    if (!el) return { ...track.last, collected: true, connected: false };
    const connected = track.nodes.some(n => n.connected && !!n.ref.deref());
    return track.last = { id: track.id, src: el.currentSrc || el.src,
      currentTime: el.currentTime, readyState: el.readyState,
      paused: el.paused, ended: el.ended, error: el.error?.code ?? null,
      connected, collected: false };
  };
  const eventFor = (track, kind, detail = {}) => emit({ at: at(), kind, ...read(track), ...detail });
  const ensure = el => {
    let track = elements.get(el);
    if (track) return track;
    track = { id: tracks.length + 1, ref: new WeakRef(el), nodes: [], last: null };
    tracks.push(track); elements.set(el, track); read(track);
    // Listeners close over weak metadata only, never the media element.
    for (const kind of ['playing', 'pause', 'error', 'ended', 'emptied', 'loadedmetadata']) {
      el.addEventListener(kind, () => eventFor(track, kind));
    }
    return track;
  };
  const api = {
    snapshot() {
      const sampledAt = at(), values = tracks.map(read);
      return { at: sampledAt, clock: 'performance.timeOrigin + performance.now',
        tracks: values.map(t => ({ ...t })), connectedCount: values.filter(t => t.connected).length,
        active: values.filter(t => t.connected && !t.paused && !t.collected).map(t => ({ ...t })),
        events: events.map(e => ({ ...e })), droppedEvents };
    },
  };
  globalThis.__conquestMedia = api;
  const media = globalThis.HTMLMediaElement?.prototype;
  if (media) {
    for (const name of ['play', 'pause']) {
      const original = media[name];
      media[name] = function (...args) {
        let track;
        try { track = ensure(this); eventFor(track, name + '-call'); } catch {}
        // Return the original promise/value unchanged. Do not attach rejection
        // handlers: doing so could hide an application unhandled rejection.
        const result = Reflect.apply(original, this, args);
        try { if (track) eventFor(track, name + '-return'); } catch {}
        return result;
      };
    }
  }
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context || !globalThis.AudioNode) return;
  const create = Context.prototype.createMediaElementSource;
  Context.prototype.createMediaElementSource = function (...args) {
    const node = Reflect.apply(create, this, args);
    try {
      const track = ensure(args[0]), state = { ref: new WeakRef(node), connected: false };
      track.nodes.push(state); sources.set(node, { track, state });
      eventFor(track, 'source-created');
    } catch {}
    return node;
  };
  for (const name of ['connect', 'disconnect']) {
    const original = globalThis.AudioNode.prototype[name];
    globalThis.AudioNode.prototype[name] = function (...args) {
      const result = Reflect.apply(original, this, args);
      try {
        const source = sources.get(this);
        if (source) {
          // A destination-specific disconnect cannot establish that every
          // output is gone. Preserve the prior state and expose ambiguity.
          if (name === 'connect') source.state.connected = true;
          else if (args.length === 0) source.state.connected = false;
          eventFor(source.track, 'source-' + name, { argumentCount: args.length,
            connectionAmbiguous: name === 'disconnect' && args.length > 0 });
        }
      } catch {}
      return result;
    };
  }
}

/** Evidence classification only, not attribution to GC or proof of audible output.
 * Inputs: request failures with engine/url/at/responseAt/failedAt/type/status;
 * snapshots as {engine,snapshot}. Duplicate same-URL failures are deliberately
 * unresolved: these inputs cannot disambiguate their range/instance ownership.
 */
export function classifyMediaCancellations(failures, mediaSnapshots) {
  const classified = [], unresolved = [];
  const finite = Number.isFinite;
  for (const failure of failures) {
    const reject = reason => unresolved.push({ request: { ...failure }, reason });
    const start = failure.started ?? failure.at, end = failure.failedAt;
    if (failure.type !== 'media' || failure.error !== 'net::ERR_ABORTED' || ![200,206].includes(failure.status)
      || ![start,end,failure.responseAt].every(finite) || start > failure.responseAt || failure.responseAt >= end) {
      reject('not-a-successful-media-response-followed-by-abort'); continue;
    }
    if (failure.status === 206) {
      const requested = /^bytes=(\d+)-(\d*)$/.exec(failure.range || '');
      const delivered = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(failure.contentRange || '');
      if (!requested || !delivered || Number(requested[1]) !== Number(delivered[1])
        || Number(delivered[2]) < Number(delivered[1]) || Number(delivered[3]) <= Number(delivered[2])
        || (requested[2] && Number(delivered[2]) > Number(requested[2]))) {
        reject('ambiguous-or-inconsistent-range-response'); continue;
      }
    }
    if (failures.filter(f => f.engine === failure.engine && f.url === failure.url).length !== 1) {
      reject('ambiguous-same-url-requests'); continue;
    }
    const snapshots = mediaSnapshots.filter(s => s.engine === failure.engine).map(s => s.snapshot);
    const latest = snapshots.filter(s => finite(s?.at) && s.at >= end).sort((a,b)=>b.at-a.at)[0];
    if (!latest || !Array.isArray(latest.events) || !Array.isArray(latest.tracks)
      || snapshots.some(s => s.droppedEvents !== 0 || s.events?.some(e => e.connectionAmbiguous || e.error || e.kind === 'error'))) {
      reject('missing-or-incomplete-observation'); continue;
    }
    const events = latest.events;
    const created = events.filter(e => e.kind === 'source-created' && e.src === failure.url && e.at <= end);
    const matches = created.filter(e => Math.abs(e.at-start) <= 250);
    if (matches.length !== 1 || new Set(created.map(e=>e.id)).size !== created.length) {
      reject('ambiguous-or-missing-request-start-instance'); continue;
    }
    const closures = [];
    for (const born of created) {
      const history = events.filter(e => e.id === born.id && e.at >= born.at && e.at <= end).sort((a,b)=>a.at-b.at);
      const closed = history.filter(e => e.kind === 'source-disconnect' && e.argumentCount === 0
        && e.connectionAmbiguous === false && e.paused === true && e.connected === false
        && e.currentTime > .1 && e.readyState >= 2 && !e.error).at(-1);
      const played = history.some(e => e.kind === 'playing' && e.at <= (closed?.at ?? -1));
      if (!closed || !played || history.some(e => e.src !== failure.url || (e.at > closed.at && (e.connected || e.paused === false)))) break;
      closures.push({ id: born.id, createdAt: born.at, disconnectedAt: closed.at, currentTime: closed.currentTime, readyState: closed.readyState });
    }
    if (closures.length !== created.length || !closures.length) { reject('same-url-instance-not-proven-stopped'); continue; }
    const lastClose = Math.max(...closures.map(c=>c.disconnectedAt));
    const samples = [...events, ...latest.tracks.map(t=>({...t,at:latest.at,kind:'snapshot'}))];
    const replacement = samples.find(e => e.src !== failure.url && typeof e.src === 'string' && e.src.length
      && e.at > lastClose && e.connected === true && e.paused === false && !e.collected && !e.error
      && e.currentTime > .1 && e.readyState >= 2
      && events.some(b => b.id === e.id && b.kind === 'source-created' && b.at <= e.at)
      && events.some(p => p.id === e.id && p.kind === 'playing' && p.at <= e.at));
    if (!replacement) { reject('no-replacement-playback-proof'); continue; }
    classified.push({ classification: 'observed-stopped-media-cancellation', request: { ...failure },
      matchedInstanceId: matches[0].id, stoppedInstances: closures,
      replacement: { id: replacement.id, src: replacement.src, at: replacement.at, currentTime: replacement.currentTime, evidenceKind: replacement.kind },
      observationAt: latest.at, limitation: 'Lifecycle correlation; does not establish browser cancellation cause or audible output.' });
  }
  return { classified, unresolved };
}
