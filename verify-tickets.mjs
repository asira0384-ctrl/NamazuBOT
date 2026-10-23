import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { createTickets, ticketCommand, ticketOverwrites } from './tickets.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ticket-test-'));
try {
 assert.equal(ticketCommand.toJSON().name,'ticket');
 const channels=new Map(), bot={user:{id:'bot'}};
 const cats={normal:{id:'cat-normal',type:ChannelType.GuildCategory},vip:{id:'cat-vip',type:ChannelType.GuildCategory}};
 Object.values(cats).forEach(c=>channels.set(c.id,c));
 let counter=0;
 const guild={channels:{fetch:async id=>id?channels.get(id):{find:fn=>[...channels.values()].find(fn)},create:async data=>{
  await new Promise(r=>setTimeout(r,5));
  const ch={...data,id:'channel-'+(++counter),send:async p=>{ch.message=p;},permissionOverwrites:{set:async p=>{ch.overwrites=p;}},setTopic:async p=>{ch.topic=p;},setName:async p=>{ch.name=p;}};
  ch.overwrites=data.permissionOverwrites;channels.set(ch.id,ch);return ch;
 }},members:{fetch:async id=>({id,permissions:{has:()=>false},roles:{cache:new Set()}})}};
 let tickets=createTickets({client:bot,guildId:'guild',dir,safeError:e=>e.message});
 function interaction({sub,type='normal',user='owner',args={},button,channel}){
  const i={guild,guildId:'guild',user:{id:user},memberPermissions:{has:()=>true},isChatInputCommand:()=>!button,isButton:()=>!!button,commandName:'ticket',customId:button,channelId:channel?.id,channel,message:{author:bot.user},options:{getSubcommand:()=>sub,getString:k=>k==='type'?type:args[k],getChannel:k=>args[k],getUser:k=>args[k],getRole:k=>args[k]},deferReply:async()=>{i.deferred=true;},editReply:async p=>{i.replyData=p;},reply:async p=>{i.replyData=p;}};return i;
 }
 async function run(spec){const i=interaction(spec);assert.equal(await tickets.handle(i),true);return i;}
 for(const type of ['normal','vip'])await run({sub:'setup',type,args:{category:cats[type]}});
 await run({sub:'staffadd',args:{user:{id:'normal-staff'}}});
 await run({sub:'staffadd',args:{user:{id:'normal-staff2'}}});
 await run({sub:'staffadd',type:'vip',args:{user:{id:'vip-staff'},role:{id:'vip-role'}}});
 await Promise.all([run({button:'tk:open:normal'}),run({button:'tk:open:normal'})]);
 assert.equal(counter,1,'concurrent clicks create only one ticket');
 await run({button:'tk:open:vip'});assert.equal(counter,2,'same owner may have both types');
 const normal=channels.get('channel-1'),vip=channels.get('channel-2');
 assert.equal(normal.parent,cats.normal.id);assert.equal(vip.parent,cats.vip.id);
 assert(normal.overwrites.some(o=>o.id==='normal-staff2'));
 assert(!normal.overwrites.some(o=>o.id==='vip-staff'));
 assert(!vip.overwrites.some(o=>o.id==='normal-staff'));
 assert(vip.message.embeds[0].toJSON().description.includes('300円/月'));
 assert(normal.overwrites.find(o=>o.id==='guild').deny.includes(P.ViewChannel));
 await run({sub:'staffremove',args:{user:{id:'normal-staff'}}});
 assert(!normal.overwrites.some(o=>o.id==='normal-staff'),'staff removal affects existing channel');
 const denied=await run({button:'tk:confirm',channel:vip,user:'normal-staff2'});
 assert(denied.replyData.content.startsWith('エラー:'));assert(!vip.topic.endsWith('closed'));
 await run({button:'tk:confirm',channel:vip});
 assert(vip.topic.endsWith('closed'));
 assert(vip.overwrites.find(o=>o.id==='owner').deny.includes(P.SendMessages));
 tickets=createTickets({client:bot,guildId:'guild',dir,safeError:e=>e.message});
 await run({button:'tk:open:normal'});assert.equal(counter,2,'open ticket persists across restart');
 await run({button:'tk:open:vip'});assert.equal(counter,3,'closed ticket allows another ticket');
 const dedup=ticketOverwrites('guild','bot','staff',{users:['staff','bot'],roles:[]});assert.equal(dedup.length,3);
 console.log('Ticket tests passed: privacy, multiple staff, duplicate prevention, staff removal, close authorization, persistence.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
