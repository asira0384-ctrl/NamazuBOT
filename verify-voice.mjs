import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createVoiceGuard, createLogBatcher, correction, voiceGuardCommand } from './voiceguard.js';
function fakeClock() {
 let now=0,id=0;const timers=new Map();
 return {schedule:(fn,delay)=>{const key=++id;timers.set(key,{fn,time:now+delay});return key;},
 cancel:key=>timers.delete(key),count:()=>timers.size,time:()=>now,
 advance:async ms=>{const end=now+ms;while(true){const next=[...timers].filter(([,v])=>v.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!next)break;now=next[1].time;timers.delete(next[0]);await next[1].fn();}now=end;}};
}
const clock=fakeClock(),batches=[];
const logger=createLogBatcher({...clock,send:async e=>batches.push({time:clock.time(),entries:e})});
for(let n=0;n<100;n++)logger.add({user:'1',kind:'mute',detail:'mute'});
assert.equal(clock.count(),1);await clock.advance(2999);assert.equal(batches.length,0);
await clock.advance(1);assert.equal(batches.length,1);assert.equal(batches[0].entries[0].count,100);
for(let n=0;n<30;n++)logger.add({user:'1',kind:'deaf',detail:'deaf'});
await clock.advance(2999);assert.equal(batches.length,1);await clock.advance(1);
assert.equal(batches.length,2);assert.equal(batches[1].time-batches[0].time,3000);logger.stop();
assert.equal(correction({channelId:'vc',selfMute:true,selfDeaf:true,serverMute:false,serverDeaf:false}),null);
assert.equal(correction({channelId:null,serverMute:true}),null);
assert.deepEqual(correction({channelId:'vc',serverMute:true,serverDeaf:true}),{mute:false,deaf:false});
assert.equal(voiceGuardCommand.toJSON().options.length,6);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vg-test-'));
const c=fakeClock();let guard,patches=[],logs=[],failNext=false;
const guildId='100000000000000001',user='200000000000000001';
let botPermissions=new PermissionsBitField(P.MuteMembers|P.DeafenMembers|P.ViewChannel|P.SendMessages);
const channel={id:'100000000000000002',guildId,isTextBased:()=>true,permissionsFor:()=>botPermissions,send:async p=>logs.push({time:c.time(),payload:p})};
const guild={id:guildId,voiceStates:{cache:new Map()},members:{me:{},fetch:async()=>({}),
 edit:async(id,patch)=>{
  if(failNext){failNext=false;const e=new Error('network reset');e.code='ECONNRESET';throw e;}
  patches.push({id,patch});
  const prev=guild.voiceStates.cache.get(id);
  const next={...prev,serverMute:'mute' in patch?false:prev.serverMute,serverDeaf:'deaf' in patch?false:prev.serverDeaf};
  guild.voiceStates.cache.set(id,next);await guard.onVoiceState(prev,next);
 }}};
const client={channels:{fetch:async()=>channel}};
function voice(extra={}){return {guild,id:user,channelId:'vc',channel,serverMute:false,serverDeaf:false,selfMute:false,selfDeaf:false,...extra};}
function command(sub,extra={}) {
 const i={guildId,guild,user:{id:'admin'},commandName:'voiceguard',memberPermissions:new PermissionsBitField(P.Administrator),
 isChatInputCommand:()=>true,options:{getSubcommand:()=>sub,getUser:()=>({id:user}),getChannel:()=>channel,getBoolean:()=>true,...extra},
 reply:async p=>{i.result=p;},deferReply:async()=>{i.deferred=true;},editReply:async p=>{i.result=p;}};
 return i;
}
async function event(oldV,newV){guild.voiceStates.cache.set(newV.id,newV);await guard.onVoiceState(oldV,newV);}
try {
 guard=createVoiceGuard({client,guildId,dir,...c});
 await guard.handle(command('log'));await guard.handle(command('add'));
 await event(voice(),voice({serverMute:true,serverDeaf:true}));
 assert.equal(patches.length,1);assert.equal(patches[0].patch.mute,false);assert.equal(patches[0].patch.deaf,false);
 assert.equal(logs.length,0); // No 3-second delay on correction.
 await event(voice(),voice({selfMute:true,selfDeaf:true}));assert.equal(patches.length,1);
 await event(voice({id:'other'}),voice({id:'other',serverMute:true}));assert.equal(patches.length,1);
 for(let n=0;n<20;n++)await event(voice(),voice({serverMute:true}));
 await c.advance(3000);assert.equal(logs.length,1);assert.match(logs[0].payload.content,/21件/);assert.deepEqual(logs[0].payload.allowedMentions,{parse:[]});
 await guard.handle(command('toggle',{getBoolean:()=>false}));
 await event(voice(),voice({serverMute:true}));assert.equal(patches.length,21);
 await guard.handle(command('toggle',{getBoolean:()=>true}));assert.equal(patches.length,22);
 botPermissions=new PermissionsBitField(P.ViewChannel|P.SendMessages);
 await event(voice(),voice({serverMute:true}));assert.equal(patches.length,22);assert.match(guard.status(),/権限がありません/);
 botPermissions=new PermissionsBitField(P.MuteMembers|P.DeafenMembers|P.ViewChannel|P.SendMessages);
 failNext=true;await event(voice(),voice({serverMute:true}));assert.equal(patches.length,22);
 await c.advance(1000);assert.equal(patches.length,23);
 await guard.handle(command('remove'));await event(voice(),voice({serverMute:true}));assert.equal(patches.length,23);
 const denied=command('add');denied.memberPermissions=new PermissionsBitField(0n);await guard.handle(denied);assert.match(denied.result.content,/管理者/);
 await guard.handle(command('add'));assert.equal(patches.length,24);
 guard.stop();guard=createVoiceGuard({client,guildId,dir,...c});assert.match(guard.status(),new RegExp(user));
 guild.voiceStates.cache.set(user,voice({serverDeaf:true}));await guard.sweep(guild);assert.equal(patches.length,25);
 guard.stop();
 console.log('PASS: immediate mute/deaf correction; 3s aggregated logging; no pings; self/unlisted users untouched; toggle/removal; permission failure; transient retry; admin checks; persistence/startup sweep');
}finally{guard?.stop();fs.rmSync(dir,{recursive:true,force:true});}
