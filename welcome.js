import fs from 'node:fs';
import path from 'node:path';
import {SlashCommandBuilder,PermissionFlagsBits as P,ChannelType,MessageFlags,EmbedBuilder} from 'discord.js';
export const welcomeCommand=new SlashCommandBuilder().setName('welcome').setDescription('ウェルカムメッセージを設定').setDefaultMemberPermissions(P.ManageGuild).setDMPermission(false)
 .addSubcommand(s=>s.setName('setup').setDescription('歓迎先・文章・埋め込みを設定').addChannelOption(o=>o.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true)).addBooleanOption(o=>o.setName('embed').setDescription('埋め込みで送信する').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('{user} {server} {count} が使えます').setMaxLength(1800).setRequired(true)).addStringOption(o=>o.setName('title').setDescription('埋め込みのタイトル').setMaxLength(256)))
 .addSubcommand(s=>s.setName('off').setDescription('ウェルカムを停止'))
 .addSubcommand(s=>s.setName('test').setDescription('自分宛てにテスト送信'));
export function createWelcome({client,guildId,dir}){
 const file=path.join(dir,'welcome.json');let config={enabled:false,channel:'',embed:true,title:'ようこそ！',message:'{user} さん、{server}へようこそ！'};
 if(fs.existsSync(file))config={...config,...JSON.parse(fs.readFileSync(file,'utf8'))};
 const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 function payload(user,guild){const text=config.message.replace(/\\n/g,'\n').replace(/\{user\}/g,'<@'+user.id+'>').replace(/\{server\}/g,guild.name).replace(/\{count\}/g,String(guild.memberCount||0));if(!config.embed)return{content:text,allowedMentions:{users:[user.id],parse:[]}};const e=new EmbedBuilder().setDescription(text).setColor(0x5865f2);if(config.title)e.setTitle(config.title);return{embeds:[e],allowedMentions:{users:[user.id],parse:[]}};}
 async function joined(member){if(member.guild.id!==guildId||!config.enabled||!config.channel)return;const ch=await client.channels.fetch(config.channel);if(ch?.guildId===guildId&&ch.isTextBased())await ch.send(payload(member.user,member.guild));}
 async function handle(i){if(!i.isChatInputCommand()||i.commandName!=='welcome')return false;if(i.guildId!==guildId)return false;if(!i.memberPermissions?.has(P.ManageGuild)){await i.reply({content:'サーバー管理権限が必要です。',flags:MessageFlags.Ephemeral});return true;}await i.deferReply({flags:MessageFlags.Ephemeral});try{const sub=i.options.getSubcommand();if(sub==='setup'){config={enabled:true,channel:i.options.getChannel('channel').id,embed:i.options.getBoolean('embed'),message:i.options.getString('message'),title:i.options.getString('title')||''};save();await i.editReply('ウェルカム設定を保存しました。');}else if(sub==='off'){config.enabled=false;save();await i.editReply('ウェルカムを停止しました。');}else{if(!config.enabled)throw new Error('先に /welcome setup を設定してください。');const ch=await client.channels.fetch(config.channel);await ch.send(payload(i.user,i.guild));await i.editReply('テストを送信しました。');}}catch(e){await i.editReply('エラー: '+String(e.message||e).slice(0,300));}return true;}
 return{handle,joined};
}
