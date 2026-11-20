import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

for (const sex of ['male','female']) {
  const base = new URL(sex==='male'?'./dist/specimen/':'./dist/female-hra/', import.meta.url);
  const parts = JSON.parse(fs.readFileSync(new URL('parts.json', base)));
  const named = new Set();
  const families = sex==='male' ? ['muscular','skeletal','joints','cardiovascular','nervous','visceral','lymphatic']
    : JSON.parse(fs.readFileSync(new URL('files.json', base)));
  if (sex==='female') {
    assert.equal(parts.find(p=>p.name==='Skin')?.referenceId,'HRAF0003');
    const reproductive=parts.filter(p=>p.system==='Reproductive');
    assert(reproductive.length>0 && reproductive.every(p=>p.referenceId.startsWith('HRAF')));
    for (const name of ['Left ovary','Right ovary','Vagina','Body of uterus']) assert(reproductive.some(p=>p.name===name));
    assert(parts.every(p=>!p.referenceId.startsWith('BM') || p.system==='Skeletal'));
    assert(parts.every(p=>! /\b(penis|penile|testicular|testis|testes|scrotum|prostate|epididymis)\b/i.test([p.name,p.note,p.latin,p.source].join(' '))));
  }
  let triangles = 0;
  for (const family of families) {
    const data = gunzipSync(fs.readFileSync(new URL(family + '.bin.gz', base)));
    const count = data.readUInt32LE(0), indexCount = data.readUInt32LE(4);
    assert(count > 0 && indexCount % 3 === 0);
    const padded = n => (n + 3) & ~3;
    const idOffset = 8 + padded(count * 6) + padded(count * 3) * 2 + padded(count * 6);
    const indexOffset = idOffset + padded(count * 2);
    assert.equal(data.length, indexOffset + indexCount * 4);
    for(let i=0;i<count;i++) {
      const id = data.readUInt16LE(idOffset+i*2), part = parts[id];
      assert(part && part.id===id && part.name && (sex==='female' || part.system.toLowerCase()===family));
      named.add(id);
      if(i%97===0) for(let axis=0;axis<3;axis++){
        const coord=data.readInt16LE(8+i*6+axis*2)/16000;
        assert(coord>=part.min[axis]-.00004 && coord<=part.max[axis]+.00004);
      }
    }
    let index = 0;
    for(let i=0;i<indexCount;i++) {
      index = (index + data.readInt32LE(indexOffset+i*4)) >>> 0;
      assert(index < count);
    }
    triangles += indexCount/3;
  }
  assert.equal(named.size, parts.length);
  for(const p of parts){
    const encoded=p.id+1;
    assert.equal((encoded&255)+(encoded>>8)*256-1,p.id);
    assert(p.max.every((v,i)=>Number.isFinite(v) && v>=p.min[i]));
  }
  console.log(`Verified ${sex} atlas, ${triangles.toLocaleString()} triangles and ${named.size} distinct pick IDs across ${families.length} model files.`);
}
