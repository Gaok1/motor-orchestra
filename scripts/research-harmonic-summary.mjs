// Publica somente artefatos locais de pesquisa; não altera o aplicativo.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const harmonic=resolve(process.argv[2]??''), multipitch=resolve(process.argv[3]??'');
if(!process.argv[3]) throw Error('Forneça os runs harmônico e multipitch');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const root=resolve(new URL('..',import.meta.url).pathname);
const data=read(join(harmonic,'validation','results.json'));
const symbolic=read(join(harmonic,'symbolic-results.json'));
const mp=read(join(multipitch,'results.json'));
if(!mp.klapuri_clock_aligned) throw Error('Corrija o relógio do Klapuri antes de resumir');
const average=xs=>xs.reduce((s,x)=>s+x,0)/(xs.length||1);
const validation=data.songs.filter(s=>s.phase==='additional-validation');
const groups=[...new Set(validation.map(s=>s.group))];
const summary={created:new Date().toISOString(),
  decision:'Do not promote continuous-v1 to production: fixes four development conflicts but worsens known soft-high-lead symbolic controls. Complementary estimators and spectral model remain research evidence, not validated resolvers.',
  runs:{harmonic,multipitch},realSongs:{total:data.songs.length,additionalTracks:validation.length,additionalGroups:groups.length,
    warning:data.warning,byBudget:[]},symbolic:[],multipitch:mp,harmonicTrace:read(join(harmonic,'development-trace.json')),
  sourceHashes:{},artifactHashes:{}};
for(const motors of data.protocol.budgets) {
  const rows=validation.map(s=>{
    const b=s.budgets.find(x=>x.motors===motors),[a,c]=b.measurements;
    return {id:s.id,group:s.group,changedPct:b.difference.changedPct,
      occupancyDelta:c.firstVoice.occupancyPct-a.firstVoice.occupancyPct,
      gapsDelta:c.firstVoice.gapsOver150ms-a.firstVoice.gapsOver150ms};
  });
  const groupMean=key=>average(groups.map(g=>average(rows.filter(x=>x.group===g).map(x=>x[key]))));
  summary.realSongs.byBudget.push({motors,groupMeanChangedPct:groupMean('changedPct'),
    groupMeanOccupancyDeltaPercentagePoints:groupMean('occupancyDelta'),groupMeanGapsDelta:groupMean('gapsDelta'),
    tracksWithFewerGaps:rows.filter(x=>x.gapsDelta<0).length,tracksWithMoreGaps:rows.filter(x=>x.gapsDelta>0).length,
    tracksWithSameGaps:rows.filter(x=>x.gapsDelta===0).length});
}
for(const family of [...new Set(symbolic.cases.map(c=>c.family))]) {
  const list=symbolic.cases.filter(c=>c.family===family);
  summary.symbolic.push({family,cases:list.length,byAlgorithm:[0,1].map(i=>({name:i?'continuous':'baseline',
    meanDesignatedLeadCoverageAt1:list[0].lead ? average(list.map(c=>c.comparisons[i].budgets[0].designatedLeadCoveragePct)):null,
    meanAllSourcesCoverageAt2:average(list.map(c=>c.comparisons[i].budgets[1].allSourcesCoveragePct)),
    meanAllSourcesCoverageAt4:average(list.map(c=>c.comparisons[i].budgets[2].allSourcesCoveragePct))})),
    regressedCaseIndices:list.filter(c=>c.lead&&c.comparisons[1].budgets[0].designatedLeadCoveragePct<c.comparisons[0].budgets[0].designatedLeadCoveragePct-1e-8).map(c=>c.k)});
}
const artifacts=[['harmonic-validation-2026-11-12.json',join(harmonic,'validation','results.json')],
  ['harmonic-symbolic-2026-11-12.json',join(harmonic,'symbolic-results.json')],
  ['multipitch-2026-11-12.json',join(multipitch,'results.json')],
  ['harmonic-model-2026-11-12.json',join(multipitch,'harmonic-model.json')]];
for(const [name,path] of artifacts){copyFileSync(path,join(root,'research',name));summary.artifactHashes[name]=hash(path);}
const snapshot=join(harmonic,'phase2-source');mkdirSync(snapshot,{recursive:true});
const sources=[...readdirSync(join(root,'scripts')).filter(n=>n.startsWith('research-')||n==='research_pitch_sets.py').map(n=>join('scripts',n)),
  'research/continuous-harmonics.mjs'];
for(const relative of sources){const path=join(root,relative);summary.sourceHashes[relative]=hash(path);
  const dest=join(snapshot,relative);mkdirSync(resolve(dest,'..'),{recursive:true});copyFileSync(path,dest);}
summary.currentArrangerMatchesFrozenBaseline=hash(join(root,'score.mjs'))===data.protocol.hashes.baseline;
writeFileSync(join(root,'research','harmonic-phase2-summary-2026-11-12.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({realSongs:summary.realSongs,symbolic:summary.symbolic,
  currentArrangerMatchesFrozenBaseline:summary.currentArrangerMatchesFrozenBaseline},null,2));
