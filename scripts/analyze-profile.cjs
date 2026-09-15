const fs = require('fs');
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const p = data.profile || data;
const nodes = p.nodes || [];
const samples = p.samples || [];
const timeDeltas = p.timeDeltas || [];
const idToNode = new Map(nodes.map((n) => [n.id, n]));
const totals = new Map();
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const dt = timeDeltas[i] || 0;
  totals.set(id, (totals.get(id) || 0) + dt);
}
const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [id, ms] of ranked) {
  const n = idToNode.get(id);
  const name = n?.callFrame?.functionName || '(anonymous)';
  const url = n?.callFrame?.url || '';
  const short = url.split('/').slice(-1)[0] || '';
  console.log(`${ms.toFixed(1)}ms\t${name}\t${short}`);
}
console.log('samples', samples.length, 'total ms', [...totals.values()].reduce((a, b) => a + b, 0).toFixed(1));
const byHit = [...nodes].sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0)).slice(0, 25);
console.log('--- hitCount ---');
for (const n of byHit) {
  if ((n.hitCount || 0) > 0) {
    console.log(n.hitCount, n.callFrame.functionName, (n.callFrame.url || '').split('/').pop());
  }
}
