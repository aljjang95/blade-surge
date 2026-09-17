// Presentation only. Called after damage is accepted, never from attack startup.
export function contactProfile(opts, crit, boss, reduced) {
  if (opts.quiet || opts.noProc) return null;
  const tier = opts.finisher ? 'finisher' : boss ? 'boss' : (opts.kb || 0) >= 6 ? 'heavy' : 'light';
  return { tier, heavy: tier !== 'light',
    stop: reduced || opts.quietStop ? 0 : tier === 'finisher' ? .065 : tier === 'boss' ? .045 : tier === 'heavy' ? .05 : crit ? .032 : opts.basic ? .032 : .022,
    haptic: opts.basic ? (tier === 'finisher' ? [18,12,36] : crit ? 22 : 14) : (tier !== 'light' ? 20 : 0),
    particles: reduced ? 0 : tier === 'light' ? 4 : 7,
    size: reduced ? .7 : tier === 'light' ? 1 : 1.45,
  };
}

// Pure window decision: one emission and at most one finisher upgrade per 60 ms.
export function contactBudget(previous, now, contact) {
  if (!contact) return null;
  if (!previous || now - previous.at >= .06 || now < previous.at) {
    return { at: now, finisher: contact.tier === 'finisher', emit: true };
  }
  if (contact.tier === 'finisher' && !previous.finisher) {
    return { at: previous.at, finisher: true, emit: false };
  }
  return null;
}
