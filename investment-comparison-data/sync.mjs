import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import core from './sync-core.js';
const directory=path.dirname(fileURLToPath(import.meta.url));
const rootIndex=process.argv.indexOf('--root');
const root=rootIndex>=0?path.resolve(process.argv[rootIndex+1]):null;
async function getText(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'CompanyComparisonDataSync/1.0'}});if(!r.ok)throw new Error('HTTP '+r.status+' '+url);const text=await r.text();if(text.length>3000000)throw new Error('來源過大');return text;}
async function source(relative){return root?fs.readFile(path.join(root,relative),'utf8'):getText(core.SOURCE_ROOT+relative);}
async function main(){
  const quoteURL=core.QUOTE_ROOT+'?symbols='+encodeURIComponent([...core.TICKERS,'US10Y'].join('|'))+'&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  const settled=await Promise.allSettled([source('nasdaq/index.html'),source('large-company-financial-dashboard/index.html'),source('earnings_hub.json'),source('macro_indicators.json'),getText(quoteURL)]);
  if(settled[0].status!=='fulfilled'||settled[1].status!=='fulfilled')throw new Error('主要模型來源無法讀取；未覆寫上一版。');
  const optional=i=>settled[i].status==='fulfilled'?JSON.parse(settled[i].value):{};
  const credit=settled[1].value;
  const packet=core.buildPacket({stocks:core.extractArray(settled[0].value,'stocks'),corps:core.extractArray(credit,'CORPS_DATA'),bonds:core.extractArray(credit,'BONDS_DATA'),earnings:optional(2),macro:optional(3),quoteBody:optional(4)});
  packet.syncWarnings=settled.flatMap((r,i)=>r.status==='rejected'?['來源 '+i+' 暫時無法更新']:[]);
  const dest=path.join(directory,'latest.json');
  let previous=null;try{previous=JSON.parse(await fs.readFile(dest,'utf8'));}catch{}
  if(previous?.schema===packet.schema){
    for(const c of packet.companies){const old=previous.companies?.find(x=>x.ticker===c.ticker);if(old?.priceAsOf&&(!c.priceAsOf||Date.parse(c.priceAsOf)<Date.parse(old.priceAsOf))){for(const k of ['price','priceAsOf','priceSource','dividendYieldPct'])c[k]=old[k];packet.syncWarnings.push(c.ticker+' 沿用上一筆帶時間報價');}}
    if(!packet.macro.updatedAt&&previous.macro)packet.macro=previous.macro;
    if(!packet.treasury&&previous.treasury)packet.treasury=previous.treasury;
  }
  await fs.writeFile(dest+'.tmp',JSON.stringify(packet,null,2)+'\n');await fs.rename(dest+'.tmp',dest);
  console.log(JSON.stringify({companies:packet.companies.length,bonds:packet.bondReferences.length,quotes:packet.sourceStatus.quotes,checkedAt:packet.checkedAt,warnings:packet.syncWarnings}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
