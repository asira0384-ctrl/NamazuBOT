import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createWelcome,welcomeCommand} from './welcome.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'welcome-'));const sent=[];
try{const client={channels:{fetch:async id=>({guildId:'123456789012345678',isTextBased:()=>true,send:async p=>sent.push(p)})}};
const w=createWelcome({client,guildId:'123456789012345678',dir});assert.equal(welcomeCommand.toJSON().name,'welcome');
function interaction(sub,vals={}){const i={guildId:'123456789012345678',commandName:'welcome',user:{id:'u1'},guild:{name:'Test',memberCount:4},memberPermissions:{has:()=>true},isChatInputCommand:()=>true,options:{getSubcommand:()=>sub,getChannel:()=>vals.channel,getBoolean:()=>vals.embed,getString:k=>vals[k]},deferReply:async()=>{},editReply:async t=>i.reply=t,reply:async t=>i.reply=t};return i;}
await w.handle(interaction('setup',{channel:{id:'welcome'},embed:true,message:'{user} / {server} / {count}',title:'Hi'}));
await w.joined({guild:{id:'123456789012345678',name:'Test',memberCount:4},user:{id:'abc'}});assert.equal(sent[0].embeds[0].data.description,'<@abc> / Test / 4');
await w.handle(interaction('setup',{channel:{id:'welcome'},embed:false,message:'Hi {user}',title:''}));await w.joined({guild:{id:'123456789012345678',name:'Test'},user:{id:'abc'}});assert.equal(sent[1].content,'Hi <@abc>');
await w.handle(interaction('off'));assert.equal(sent.length,2);console.log('PASS: custom welcome, embed/plain choice, placeholders, per-guild disable');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
