// Somente candidatos são lidos pelo arranjador; referências permanecem no Python.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const run=resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Forneça o run');
const protocol=JSON.parse(readFileSync(join(run,'protocol.json')));
const {arrangeMotors}=await import(pathToFileURL(join(run,'snapshot','score.mjs')));
const measurements=[];
for(const file of readdirSync(join(run,'candidates')).filter(x=>x.endsWith('.json'))) {
  const source=JSON.parse(readFileSync(join(run,'candidates',file)));
  const path=join(run,'arrangements',file);
  if(existsSync(path))continue;
  const job={...source,title:source.id,density:{alta:source.notes}};
  const scores=[];
  for(const motors of protocol.budgets) {
    const started=performance.now();const score=arrangeMotors(job,motors,protocol.options);
    const milliseconds=performance.now()-started;
    for(const track of score.tracks)for(let i=0;i<track.length;i++) {
      assert.ok(track[i].end>track[i].start);
      if(i)assert.ok(track[i-1].end<=track[i].start+1e-9);
    }
    scores.push({motors,milliseconds,processPeakRSSMiBCumulative:process.resourceUsage().maxRSS/1024,
      tracks:score.tracks.map(t=>t.map(n=>[n.start,n.end,n.midi,n.vel]))});
  }
  writeFileSync(path,JSON.stringify({id:source.id,scores}));
  measurements.push({id:source.id,budgets:scores.map(({tracks,...x})=>x)});
  console.log(source.id,scores.map(x=>x.milliseconds.toFixed(1)).join(','));
}
writeFileSync(join(run,'baseline-timing-latest.json'),JSON.stringify(measurements,null,2)+'\n');
