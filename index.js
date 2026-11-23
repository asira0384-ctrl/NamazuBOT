import http from 'node:http';
import { Client, GatewayIntentBits } from 'discord.js';
import { prepareStorage } from './guild-storage.js';
import { createGuildRuntime, cmd } from './guild-runtime.js';
import { ticketCommand } from './tickets.js';
import { rolePanelCommand } from './rolepanels.js';
import { voiceGuardCommand } from './voiceguard.js';
import { welcomeCommand } from './welcome.js';
import { PermissionFlagsBits } from 'discord.js';
const token=process.env.DISCORD_TOKEN;
if(!token)throw new Error('DISCORD_TOKENを設定してください');
const directory=prepareStorage(process.env.DATA_DIR||'./data',process.env.GUILD_ID);
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
const runtimes=new Map();
function report(e){console.error(String(e?.message||e).split(token).join('[TOKEN]'));}
function activate(guild){
 if(!guild?.available)return;
 let rt=runtimes.get(guild.id);
 if(rt)return rt;
 rt=createGuildRuntime({client,guildId:guild.id,dir:directory(guild.id)});
 runtimes.set(guild.id,rt);rt.start(guild);
 guild.commands.set([cmd,rolePanelCommand,voiceGuardCommand,ticketCommand,welcomeCommand].map(c=>c.toJSON())).catch(e=>{console.error('コマンド登録失敗: '+guild.id);report(e);});
 return rt;
}
function attach(g){try{activate(g);}catch(e){report(e);}}
function detach(g){runtimes.get(g.id)?.stop();runtimes.delete(g.id);}
client.once('clientReady',()=>{for(const g of client.guilds.cache.values())attach(g);console.log('Ready v1.8: '+client.user.tag);});
client.on('guildCreate',attach);client.on('guildAvailable',attach);client.on('guildDelete',detach);client.on('guildUnavailable',detach);
client.on('interactionCreate',async i=>{try{await activate(i.guild)?.handle(i);}catch(e){report(e);}});
client.on('guildMemberAdd',m=>{try{activate(m.guild)?.onMemberJoin(m).catch(report);}catch(e){report(e);}});
client.on('messageCreate',async m=>{if(m.author.bot||!m.guild||!m.content.startsWith('!delete'))return;const match=m.content.match(/^!delete\s+(\d+)\s*$/i);if(!match)return;if(!m.member?.permissions.has(PermissionFlagsBits.Administrator)){await m.delete().catch(()=>{});return;}await m.delete().catch(()=>{});const n=Math.min(100,Math.max(1,Number(match[1])));try{const deleted=await m.channel.bulkDelete(n,true);const notice=await m.channel.send('メッセージを削除しました');setTimeout(()=>notice.delete().catch(()=>{}),2000);}catch(e){report(e);}});
client.on('voiceStateUpdate',async(a,b)=>{try{await activate(b.guild)?.onVoice(a,b);}catch(e){report(e);}});
client.on('error',report);
http.createServer((req,res)=>{res.writeHead(client.isReady()?200:503);res.end(client.isReady()?'OK':'Starting');}).listen(Number(process.env.PORT||3000));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const rt of runtimes.values())rt.stop();client.destroy();process.exit(0);});
client.login(token).catch(e=>{report(e);process.exit(1);});
