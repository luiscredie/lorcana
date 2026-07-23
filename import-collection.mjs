#!/usr/bin/env node
// Reusable, idempotent collection importer for the Lorcana Dashboard.
//
//   node import-collection.mjs
//
// Reads (UTF-8/BOM, quoted-comma safe):
//   uploads/lorcana_card_database_master.csv     — full catalogue (3442 printings)
//   uploads/mapeamento_dreamborn_ligalorcana.csv  — owned snapshot (528 rows)
//   collection.json (existing)                    — only to preserve the legacy set/num representative
//
// Writes three layers:
//   card-catalog-master.json   — every printing, keyed by Database ID (primary), ligaId secondary
//   collection-printings.json  — exact owned snapshot, keyed "ligaId:variant" (source of truth)
//   collection.json            — derived legacy per-name view (backward compatible)
//
// Rerunning REPLACES the snapshot (never sums). Fails loudly on ambiguity.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MASTER='uploads/lorcana_card_database_master.csv';
const MAP='uploads/mapeamento_dreamborn_ligalorcana.csv';

function parseCSV(t){ t=t.replace(/^\uFEFF/,''); const rows=[]; let f=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const ch=t[i];
    if(q){ if(ch==='"'){ if(t[i+1]==='"'){cur+='"';i++;} else q=false;} else cur+=ch; }
    else { if(ch==='"')q=true; else if(ch===','){f.push(cur);cur='';} else if(ch==='\n'){f.push(cur);rows.push(f);f=[];cur='';} else if(ch==='\r'){} else cur+=ch; } }
  if(cur!==''||f.length){f.push(cur);rows.push(f);} return rows; }
const obj=(H,r)=>{const o={};H.forEach((h,i)=>o[h]=r[i]!=null?r[i]:'');return o;};
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&#8208;/g,'-').replace(/&ndash;/g,'\u2013').replace(/&mdash;/g,'\u2014').replace(/&rsquo;/g,'\u2019');
const decodeFull=s=>decode(decode(s));
const colKey=n=>String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\u2018\u2019\u02BC]/g,"'").replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim().replace(/4\s*-?\s*town\b/g,'4town');
const setNum=code=>{ const m=String(code||'').match(/^LOR(\d+)$/i); return m?String(parseInt(m[1],10)).padStart(3,'0'):code; };
const isRegular=p=>/^LOR\d+$/i.test(p.set) && !/epic|enchanted/i.test((p.rarity||'')+(p.ligaNameRaw||''));
const COLOR={S:'Sapphire',A:'Amber',E:'Emerald',R:'Ruby',T:'Steel',M:'Amethyst'};

function build(){
  // 1. Master catalogue
  const mrows=parseCSV(readFileSync(MASTER,'utf8')); const MH=mrows[0];
  const mdata=mrows.slice(1).filter(r=>r.length>=MH.length && r[0]);
  const catalog={}; const eds=new Set();
  for(const r of mdata){ const o=obj(MH,r); const id=o['Database ID'];
    if(catalog[id]) throw new Error('Duplicate Database ID: '+id);
    eds.add(o['Edicao (Sigla)']);
    catalog[id]={ databaseId:id, ligaId:o['LigaLorcana ID'], displayName:o['Display Name'], imageUrl:o['Image URL']||'',
      editionName:o['Edicao (EN)'], editionCode:o['Edicao (Sigla)'], cardNumber:o['Card #'],
      ligaNameRaw:o['Card (EN)'], rarity:o['Raridade'], color:o['Cor (C D O E Y F R G L M P W)'], extra:o['Extras'],
      ownedNormal:+o['Owned Normal']||0, ownedFoil:+o['Owned Foil']||0, inCollection:o['In Collection']==='TRUE' }; }
  writeFileSync('card-catalog-master.json', JSON.stringify(catalog));

  // 2. Exact printings snapshot
  const prows=parseCSV(readFileSync(MAP,'utf8')); const PH=prows[0];
  const pdata=prows.slice(1).filter(r=>r.length>=PH.length && r[PH.indexOf('LigaLorcana ID')]);
  const printings={}; let total=0,foilRows=0,noUrl=0; const ids=new Set(),urls=new Set();
  for(const r of pdata){ const o=obj(PH,r); const ligaId=o['LigaLorcana ID']; const variant=(o['Variant']||'normal').toLowerCase();
    const count=+o['Count']||0; const id=ligaId+':'+variant;
    if(printings[id]) throw new Error('Duplicate collection row: '+id);
    if(!ligaId) throw new Error('Empty LigaLorcana ID in row: '+JSON.stringify(o));
    total+=count; if(variant==='foil')foilRows++; ids.add(ligaId); if(o['Image URL'])urls.add(o['Image URL']); else noUrl++;
    printings[id]={ id, ligaId, variant, count, set:o['LigaLorcana Edition Code'], num:o['LigaLorcana Card Number'],
      name:o['Name'], ligaNameRaw:o['LigaLorcana Card Name'], displayName:decodeFull(o['LigaLorcana Card Name']||o['Name']),
      color:o['LigaLorcana Color Code'], rarity:o['LigaLorcana Rarity Code'], imageUrl:o['Image URL']||'',
      dbSet:o['Set Number'], dbNum:o['Card Number'] }; }
  writeFileSync('collection-printings.json', JSON.stringify(printings));

  // 3. Derived legacy per-name view
  const existing = existsSync('collection.json') ? JSON.parse(readFileSync('collection.json','utf8')) : {};
  const groups={}; for(const p of Object.values(printings)){ const k=colKey(p.name); (groups[k]=groups[k]||[]).push(p); }
  const legacy={}; const fallbacks=[];
  for(const k of Object.keys(groups)){
    const ps=groups[k]; let normalQty=0,foilQty=0;
    for(const p of ps){ if(p.variant==='foil')foilQty+=p.count; else normalQty+=p.count; }
    const printingCount=new Set(ps.map(p=>p.ligaId)).size;
    let rep=null; const ex=existing[k];
    if(ex&&ex.set!=null&&ex.num!=null) rep=ps.find(p=>setNum(p.set)===String(ex.set)&&String(p.num)===String(ex.num));
    if(!rep){ const regs=ps.filter(isRegular); const pool=regs.length?regs:ps;
      const normals=pool.filter(p=>p.variant==='normal'); const cand=(normals.length?normals:pool).slice();
      cand.sort((a,b)=>(parseInt(a.num,10)||9999)-(parseInt(b.num,10)||9999)); rep=cand[0];
      if(!regs.length) fallbacks.push(ps[0].name+' (no regular printing owned)'); }
    const rec={ name:ps[0].name, qty:normalQty+foilQty, foil:foilQty>0?1:0,
      color:(ex&&ex.color)||COLOR[rep.color]||'', rarity:(ex&&ex.rarity)||'',
      set:setNum(rep.set), num:parseInt(rep.num,10),
      normalQty, foilQty, printingCount, pricingApproximate:(printingCount>1)||(normalQty>0&&foilQty>0) };
    legacy[k]=rec;
  }
  writeFileSync('collection.json', JSON.stringify(legacy));

  // Validation report
  const sumQty=Object.values(legacy).reduce((x,r)=>x+r.qty,0);
  console.log('— Master catalogue —');
  console.log('  records: '+Object.keys(catalog).length+'  editions: '+eds.size);
  console.log('— Exact collection —');
  console.log('  rows: '+Object.keys(printings).length+'  total copies: '+total+'  distinct ligaId: '+ids.size);
  console.log('  rows with URL: '+urls.size+'  rows without URL: '+noUrl+'  foil rows: '+foilRows);
  console.log('— Legacy view —');
  console.log('  names: '+Object.keys(legacy).length+'  sum qty: '+sumQty+'  approximate: '+Object.values(legacy).filter(r=>r.pricingApproximate).length);
  if(fallbacks.length){ console.log('— Fallback representatives —'); fallbacks.forEach(f=>console.log('  '+f)); }
  if(sumQty!==total) throw new Error('Legacy qty sum ('+sumQty+') != snapshot total ('+total+')');
}
build();
