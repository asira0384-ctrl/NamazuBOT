import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createRolePanels, rolePanelCommand, validateRole } from './rolepanels.js';
assert.equal(rolePanelCommand.toJSON().options.length,3);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rp-test-'));
const guildId='100000000000000001', channelId='100000000000000002';
const r1='200000000000000001', r2='200000000000000002', unrelated='200000000000000003';
const perms=n=>new PermissionsBitField(n);
const bot={permissions:perms(P.ManageRoles),roles:{highest:{comparePositionTo:()=>1}}};
const actor={id:'owner',roles:{highest:{comparePositionTo:()=>1}}};
const role=id=>({id,name:id===r1?'Live':'News',guild:{id:guildId},permissions:perms(0n),managed:false});
const roles=new Map([[r1,role(r1)],[r2,role(r2)]]);
assert.throws(()=>validateRole({...role(r1),permissions:perms(P.Administrator)},bot,null,'owner'),/公開配布/);
assert.throws(()=>validateRole(role(r1),{...bot,roles:{highest:{comparePositionTo:()=>0}}},null,'owner'),/より上/);
let messages=[],count=0;
const ch={id:channelId,guildId,isTextBased:()=>true,permissionsFor:()=>perms(P.ViewChannel|P.SendMessages|P.EmbedLinks),
 send:async payload=>{for(const c of payload.components)c.toJSON();for(const e of payload.embeds)e.toJSON();messages.push(payload);return {id:'message-'+(++count),url:'https://discord.com/test',delete:async()=>{}};},
 messages:{delete:async()=>{}}};
const held=new Map([[unrelated,{}]]),writes=[];
const member={roles:{cache:held,add:async id=>{held.set(id,{});writes.push('add:'+id);},remove:async id=>{held.delete(id);writes.push('remove:'+id);}}};
const guild={ownerId:'owner',members:{fetchMe:async()=>bot,fetch:async({user})=>user==='owner'?actor:member},roles:{fetch:async()=>roles}};
const client={channels:{fetch:async()=>ch}};
let handler=createRolePanels({client,guildId,dir});
function interaction(type,extra={}) {
 const i={guildId,guild,channelId,user:{id:type==='command'||type==='build'?'owner':'member'},memberPermissions:perms(P.ManageGuild|P.ManageRoles),
  isChatInputCommand:()=>type==='command',isRoleSelectMenu:()=>type==='build',isStringSelectMenu:()=>type==='toggle',
  commandName:'rolepanel',deferReply:async()=>{i.deferred=true;},editReply:async p=>{i.response=p;},reply:async p=>{i.response=p;},...extra};return i;
}
try {
 const create=interaction('command',{options:{getSubcommand:()=> 'create',getChannel:()=>ch,getString:()=>null}});
 await handler.handle(create);
 const buildId=create.response.components[0].toJSON().components[0].custom_id;
 const build=interaction('build',{customId:buildId,values:[r1,r2]});
 await handler.handle(build);
 assert.equal(messages.length,1);
 const id=Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'rolepanels.json'))))[0];
 const toggle=()=>interaction('toggle',{customId:'rp:toggle:'+id,values:[r1,r2],message:{id:'message-1'}});
 await handler.handle(toggle());assert(held.has(r1)&&held.has(r2)&&held.has(unrelated));
 // Recreate handler to emulate process restart.
 handler=createRolePanels({client,guildId,dir});
 await handler.handle(toggle());assert(!held.has(r1)&&!held.has(r2)&&held.has(unrelated));
 const forged=toggle();forged.values=[unrelated];await handler.handle(forged);assert.match(forged.response.content,/登録されていない/);
 roles.get(r1).permissions=perms(P.ManageRoles);
 const unsafe=toggle();await handler.handle(unsafe);assert.match(unsafe.response.content,/公開配布/);assert.equal(writes.length,4);
 roles.get(r1).permissions=perms(0n);
 const wrong=toggle();wrong.message.id='other';await handler.handle(wrong);assert.match(wrong.response.content,/無効/);
 const del=interaction('command',{options:{getSubcommand:()=> 'delete',getString:()=>id}});
 await handler.handle(del);
 const deleted=toggle();await handler.handle(deleted);assert.match(deleted.response.content,/無効/);
 console.log('PASS: create and component validation; multi-role add/remove; unrelated roles preserved; restart persistence; forged value/message rejected; permissions rechecked; deletion invalidates panel');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
