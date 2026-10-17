import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { runScript, validateScript, type ScriptResult } from '../src/playground/Script';

export function fixture(name: string) {
  return validateScript(JSON.parse(readFileSync(`playground/scripts/stage3/${name}.json`, 'utf8')));
}
export function measure(result: ScriptResult) {
  const kick = result.events.find((e) => e.type === 'kick');
  if (!kick) return null;
  const flight = result.frames.filter((f) => f.t >= kick.t);
  const next = result.events.find((e) => e.t > kick.t && ['bounce', 'kick', 'save', 'keeperBlock', 'smother', 'post', 'goal'].includes(e.type));
  const reception = flight.find((f) => f.owner !== null);
  const ground = flight.find((f, i) => i > 0 && f.ball.pos[1] < 0.16 && flight[i - 1].ball.vel[1] < 0 && f.ball.vel[1] >= 0);
  const stop = Math.min(next?.t ?? Infinity, reception?.t ?? Infinity, ground?.t ?? Infinity);
  const firstFlight = flight.filter((f) => f.t < stop - 1e-9);
  const velocity = kick.velocity as number[];
  const receiver = kick.receiver as string | null;
  return {
    kind: kick.kind, speed: Math.hypot(...velocity), horizontal: Math.hypot(velocity[0], velocity[2]),
    peak: Math.max(...firstFlight.map((f) => f.ball.pos[1])), receiver,
    received: !!receiver && flight.some((f) => f.owner === receiver),
    lead: kick.target && kick.receiverPosition ? Math.hypot((kick.target as number[])[0] - (kick.receiverPosition as number[])[0], (kick.target as number[])[2] - (kick.receiverPosition as number[])[2]) : null,
    bounceX: next?.type === 'bounce' ? result.frames.find((f) => f.t >= next.t)?.ball.pos[0] : null,
    kick,
  };
}

if (process.argv.includes('--report')) {
  const table = [];
  for (const file of readdirSync('playground/scripts/stage3').filter((f) => f.endsWith('.json')).sort()) {
    const name = file.replace('.json', '');
    const results = Array.from({ length: 20 }, (_, seed) => runScript({ ...fixture(name), seed }));
    const values = results.map(measure).filter((v) => v !== null);
    table.push({ name, count: results.length, kinds: [...new Set(values.map((v) => v.kind))],
      horizontal: values.length ? values.reduce((s, v) => s + v.horizontal, 0) / values.length : null,
      peakMin: values.length ? Math.min(...values.map((v) => v.peak)) : null,
      peakMax: values.length ? Math.max(...values.map((v) => v.peak)) : null,
      executed: values.length,
      speed: values.length ? values.reduce((s, v) => s + v.speed, 0) / values.length : null,
      peak: values.length ? values.reduce((s, v) => s + v.peak, 0) / values.length : null,
      receiver: values[0]?.receiver ?? null, received: values.filter((v) => v.received).length,
      goals: results.filter((r) => r.events.some((e) => e.type === 'goal' && e.team === 0)).length,
      timed: values.filter((v) => v.kick.timed).length,
      contacts: results.filter((r) => r.events.some((e) => e.type === 'contact')).length,
      fouls: results.filter((r) => r.events.some((e) => e.type === 'foul')).length,
      success: results.filter((r) => r.events.some((e) => e.type === 'contact' && e.success)).length,
    });
  }
  writeFileSync('docs/roadmap/stage3-measurements.json', JSON.stringify(table, null, 2) + '\n');
  console.table(table);
}
