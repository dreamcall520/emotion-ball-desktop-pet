'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const error=()=>Object.assign(new Error('ENCRYPTED_STORE_FAILED'),{code:'ENCRYPTED_STORE_FAILED'});
function createEncryptedStore({directory,keyBase64}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof keyBase64!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(keyBase64))throw error();
 const key=Buffer.from(keyBase64,'base64');if(key.length!==32||key.toString('base64')!==keyBase64)throw error();
 const file=k=>{if(typeof k!=='string'||!/^[A-Za-z0-9_-]{16,200}$/.test(k))throw error();return path.join(directory,k+'.enc');};
 async function prepare(){await fs.mkdir(directory,{recursive:true,mode:0o700});const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw error();await fs.chmod(directory,0o700);}
 return {
  async get(id){try{const target=file(id);await prepare();let h;try{h=await fs.open(target,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}let content;try{const st=await h.stat();if(!st.isFile()||st.size>1500000)throw error();content=await h.readFile('utf8');}finally{await h.close();}
   const p=JSON.parse(content);if(p.v!==1||typeof p.iv!=='string'||typeof p.tag!=='string'||typeof p.data!=='string')throw error();
   const dec=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));dec.setAAD(Buffer.from(id));dec.setAuthTag(Buffer.from(p.tag,'base64'));
   return JSON.parse(Buffer.concat([dec.update(Buffer.from(p.data,'base64')),dec.final()]).toString('utf8'));
  }catch{throw error();}},
  async set(id,record){let temporary;try{const target=file(id);await prepare();const plain=Buffer.from(JSON.stringify(record));if(plain.length>1000000)throw error();const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(plain),cipher.final()]);temporary=path.join(directory,'.tmp-'+randomBytes(16).toString('hex'));
   await fs.writeFile(temporary,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600,flag:'wx'});await fs.rename(temporary,target);
  }catch{throw error();}finally{if(temporary)await fs.unlink(temporary).catch(()=>{});}},
  async delete(id){try{await fs.unlink(file(id));}catch(e){if(e.code!=='ENOENT')throw error();}}
 };
}
module.exports={createEncryptedStore};
