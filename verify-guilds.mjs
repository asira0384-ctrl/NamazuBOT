import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareStorage} from './guild-storage.js';
import {createGuildRuntime} from './guild-runtime.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'guild-test-')),old='123456789012345678',other='223456789012345678';
try{
 const cfg={user:'original',channel:'one',rooms:[]};
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify(cfg));
 for(const f of ['tickets','rolepanels','voiceguard'])fs.writeFileSync(path.join(root,f+'.json'),'{}');
 assert.throws(()=>prepareStorage(root),/GUILD_ID/);
 const dir=prepareStorage(root,old);
 const seen=[];const make=id=>createGuildRuntime({guildId:id,dir:dir(id),lookup:async()=>({live:true,room:'room',details:{}}),client:{channels:{fetch:async c=>({guildId:c==='one'?old:other,isTextBased:()=>true,send:async()=>seen.push(c)})}}});
 for(const f of ['tickets','rolepanels','voiceguard']){assert(fs.existsSync(path.join(dir(old),f+'.json')));assert(!fs.existsSync(path.join(dir(other),f+'.json')));}
 const a=make(old),b=make(other);assert.equal(a.state.user,'original');assert.equal(b.state.user,'');
 b.state.user='original';b.state.channel='two';await Promise.all([a.detect(),b.detect()]);assert.deepEqual(seen.sort(),['one','two']);
 assert.equal(make(other).state.channel,'two');prepareStorage(root,other);assert.equal(make(old).state.rooms.length,1);
 console.log('PASS: legacy settings migration, clean second guild, separate notification delivery and persistence');
}finally{fs.rmSync(root,{recursive:true,force:true});}
