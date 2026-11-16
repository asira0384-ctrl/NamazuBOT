import fs from 'node:fs';
import path from 'node:path';
const files=['settings.json','rolepanels.json','voiceguard.json','tickets.json'];
export function prepareStorage(root,legacyId) {
 const base=path.join(root,'guilds');
 fs.mkdirSync(base,{recursive:true});
 const present=files.filter(f=>fs.existsSync(path.join(root,f)));
 if(present.length && !fs.existsSync(path.join(base,'.legacy-imported'))) {
  if(!/^\d{17,20}$/.test(legacyId||''))throw new Error('旧設定の引き継ぎには元のサーバーのGUILD_IDが必要です。');
  const dest=path.join(base,legacyId);
  if(!fs.existsSync(dest)){
   const tmp=fs.mkdtempSync(path.join(base,'.import-'));
   try{for(const f of present){const data=fs.readFileSync(path.join(root,f));JSON.parse(data);fs.writeFileSync(path.join(tmp,f),data,{mode:0o600});}
    fs.renameSync(tmp,dest);
   }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  }
  fs.writeFileSync(path.join(base,'.legacy-imported'),legacyId,{mode:0o600});
 }
 return id=>{if(!/^\d{17,20}$/.test(id))throw new Error('Invalid guild ID');const dest=path.join(base,id);fs.mkdirSync(dest,{recursive:true});return dest;};
}
