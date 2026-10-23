import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareDataDir } from './storage.js';
import { createMcControl, mcCommand } from './mccontrol.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'namazu-test-'));
try {
 const old=path.join(root,'data'),vol=path.join(root,'volume');fs.mkdirSync(old);
 for(const name of ['settings.json','rolepanels.json','voiceguard.json']) fs.writeFileSync(path.join(old,name),JSON.stringify({test:name}));
 const env={RAILWAY_VOLUME_MOUNT_PATH:vol,DATA_DIR:'/wrong'};
 assert.equal(prepareDataDir(env,root),vol);
 fs.writeFileSync(path.join(vol,'settings.json'),'{"changed":true}');
 prepareDataDir(env,root);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(vol,'settings.json'))),{changed:true});
 for(const name of ['rolepanels.json','voiceguard.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(vol,name))).test,name);
 assert(mcCommand.toJSON().options.some(o=>o.name==='panel'));
 let posted,reply,fetched=0;
 const handler=createMcControl({guildId:'g',safeError:e=>e.message});
 const base={guildId:'g',memberPermissions:{has:()=>true},isButton:()=>false,isChatInputCommand:()=>true,commandName:'mc',options:{getSubcommand:()=> 'panel'},deferReply:async()=>{},editReply:async x=>reply=x,channel:{send:async x=>posted=x}};
 await handler.handle(base);assert.equal(posted.components[0].components[0].data.custom_id,'mc:inviteall');
 const denied={...base,isButton:()=>true,customId:'mc:inviteall',memberPermissions:{has:()=>false},reply:async x=>reply=x};
 await handler.handle(denied);assert.match(reply.content,/管理者/);
 process.env.MC_BOT_URL='https://mc.example';process.env.MC_API_KEY='test';
 globalThis.fetch=async (url,opt)=>{fetched++;assert.equal(url.pathname,'/invite-all');assert.equal(opt.method,'POST');assert.equal(opt.headers.Authorization,'Bearer test');return {ok:true,json:async()=>({})}};
 // A fresh handler after restart accepts the old persistent button ID.
 await createMcControl({guildId:'g',safeError:e=>e.message}).handle({...base,isButton:()=>true,customId:'mc:inviteall'});
 assert.equal(fetched,1);console.log('PASS: persistent storage migration, preserve existing data, button registration, permission checks, restart-safe button, API request');
} finally {fs.rmSync(root,{recursive:true,force:true});}
