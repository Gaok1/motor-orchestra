// Controles de seleção com candidatos conhecidos; não testam transcrição acústica.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Forneça o run do protótipo');
const modules=await Promise.all(['baseline','prototype'].map(n=>import(pathToFileURL(join(root,`${n}-score.mjs`)))));
let seed=912743;
const random=()=>{ seed=(1664525*seed+1013904223)>>>0; return seed/2**32; };
const cases=[];
for(let k=0;k<36;k++) {
  const shift=[-12,0,12][k%3], dt=[.12,.25,.5,.8][Math.floor(k/3)%4];
  const lead=[60,62,64,62,60,59,60,62].map((p,i)=>[.1+i*dt,.1+(i+.87)*dt,p+shift,.55]);
  const interval=[12,19,28,31][k%4];
  const ghosts=lead.map(([a,b,p])=>[Math.max(0,a-(.015+.035*random())),a+(b-a)*(.55+.4*random()),p+interval,.27+.1*random()]);
  cases.push({family:'jittered-harmonic-shadows',k,notes:[...lead,...ghosts],lead,reference:lead});
  const high=lead.map(([a,b,p])=>[a,b,p+19,.32+.05*random()]);
  const chords=(k%2 ? lead : [[.1,.1+8*dt]])
    .flatMap(([a,b])=>[[a,b,36+shift,.85],[a,b,48+shift,.7],[a,b,53+shift,.65]]);
  cases.push({family:'soft-independent-high',k,notes:[...high,...chords],lead:high,reference:[...high,...chords]});
  const upper=lead.map(([a,b,p],i)=>[a+.04,b+.04,p+(i%3 ? 19 : 20),.38]);
  cases.push({family:'staggered-divergent-upper',k,notes:[...lead,...upper],lead:upper,reference:[...lead,...upper]});
  const parallel=lead.map(([a,b,p])=>[a,b,p+interval,.36]);
  cases.push({family:'true-parallel-ambiguous',k,notes:[...lead,...parallel],lead:null,reference:[...lead,...parallel]});
}
function measure(tracks,reference) {
  let hits=0,total=0;
  for (const [a,b,p] of reference) {
    // Integração por bordas dos eventos, sem tolerância nem caudas inventadas.
    let covered=0;
    const pieces=tracks.flat().filter(n=>n.midi===p).map(n=>[Math.max(a,n.start),Math.min(b,n.end)]).filter(([s,e])=>e>s).sort((x,y)=>x[0]-y[0]);
    let end=-Infinity;
    for(const [s,e] of pieces){covered+=Math.max(0,e-Math.max(end,s));end=Math.max(end,e);}
    hits+=covered;total+=b-a;
  }
  return 100*hits/(total||1);
}
const results={seed:912743,warning:'144 symbolic scenarios, correlated generated variants, not 144 independent musical works. Lead labels are designated by construction; synchronized true parallels deliberately have no unique lead label.',cases:[]};
for(const c of cases) {
  const comparisons=[];
  for (const [i,module] of modules.entries()) {
    const budgets=[];
    for(const motors of [1,2,4]) {
      const notes=structuredClone(c.notes);
      const tracks=module.dynamicLines(notes,motors,{melody:true,harmony:true,voicing:true,double:false});
      assert.deepEqual(notes,c.notes);
      for(const track of tracks) for(let j=0;j<track.length;j++) {
        assert.ok(track[j].end>track[j].start);
        if(j) assert.ok(track[j].start>=track[j-1].end-1e-9);
      }
      budgets.push({motors,designatedLeadCoveragePct:c.lead ? measure([tracks[0]],c.lead):null,
        allSourcesCoveragePct:measure(tracks,c.reference)});
    }
    comparisons.push({name:i?'continuous':'baseline',budgets});
  }
  results.cases.push({...c,comparisons});
}
writeFileSync(join(root,'symbolic-results.json'),JSON.stringify(results,null,2)+'\n');
for(const family of [...new Set(cases.map(c=>c.family))]) {
  const list=results.cases.filter(c=>c.family===family);
  console.log(JSON.stringify({family,cases:list.length,results:[0,1].map(i=>({name:i?'continuous':'baseline',
    leadAt1:list[0].lead ? list.reduce((s,c)=>s+c.comparisons[i].budgets[0].designatedLeadCoveragePct,0)/list.length:null,
    allAt2:list.reduce((s,c)=>s+c.comparisons[i].budgets[1].allSourcesCoveragePct,0)/list.length,
    allAt4:list.reduce((s,c)=>s+c.comparisons[i].budgets[2].allSourcesCoveragePct,0)/list.length}))}));
}
