import { simulate } from '/home/user/bs-3month/tools/sim-90d.mjs';
import fs from 'node:fs';
const [persona, ...seedArgs] = process.argv.slice(2);
const out = {};
for (const s of seedArgs.map(Number)) { const r = simulate(persona, s); out[s] = { days: r.days, milestones: r.milestones, sssrDay: r.sssrDay, totals: r.totals }; }
fs.writeFileSync(true ? `/tmp/claude-0/-home-user-blade-surge/fa8e9051-5a5a-564a-887a-e3ba2373c88e/scratchpad/work/days-${persona}.json` : '/dev/null', JSON.stringify(out));
console.log('ok', persona, Object.keys(out));
