import {constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, type Stats} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {assertValidSlug, resolveDataRoot} from 'utarus';

function directory(path: string): boolean {
  const stat=lstatSync(path,{throwIfNoEntry:false});
  if(!stat)return false;
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Raw-data directory must be an ordinary directory');
  return true;
}
function rootFor(slug: string): string {
  assertValidSlug(slug);
  const drive=join(realpathSync(resolveDataRoot()),'drive');
  if(directory(drive))directory(join(drive,slug));
  return join(drive,slug);
}
function version(stat: Stats): string {return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;}
export interface RawFile {id:string;channel:string|null;source_kind:'broker-sync'|'broker-triage'|'drive-file';bytes:number;modified_at:string;version:string;}
function describe(id:string,stat:Stats):RawFile {
  const parts=id.split('/');
  let channel:string|null=null;
  let source_kind:RawFile['source_kind']='drive-file';
  if(parts[0]==='ibkr-flex'){channel='ibkr';source_kind='broker-sync';}
  if(parts[0]==='tiger-raw'){channel='tiger';source_kind='broker-sync';}
  if(parts[0]==='moomoo-raw'){channel='moomoo';source_kind='broker-sync';}
  if(parts[0]==='broker-raw'&&parts.length>=3){channel=parts[1]!;source_kind='broker-triage';}
  return {id,channel,source_kind,bytes:stat.size,modified_at:stat.mtime.toISOString(),version:version(stat)};
}
function ordinary(stat:Stats):void {
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('Raw-data file must be an ordinary, unlinked file');
}
export function listRawData(slug:string,offset:number,limit:number,channel?:string) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid raw-data list pagination');
  if(channel!==undefined&&!channel.trim())throw new Error('Channel must be nonempty when supplied');
  const root=rootFor(slug);const files:RawFile[]=[];
  function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);const stat=lstatSync(path);
    if(stat.isSymbolicLink())throw new Error('Symlink in raw-data storage');
    if(stat.isDirectory()){walk(path);continue;}
    ordinary(stat);
    const item=describe(relative(root,path).split(sep).join('/'),stat);
    if(channel===undefined||item.channel===channel)files.push(item);
  }}
  if(directory(root))walk(root);
  files.sort((a,b)=>b.modified_at.localeCompare(a.modified_at)||a.id.localeCompare(b.id));
  return {files:files.slice(offset,offset+limit),total:files.length,next_offset:offset+limit<files.length?offset+limit:null};
}
export function fetchRawData(slug:string,id:string,expectedVersion:string,offset:number,maxBytes:number,encoding:'utf8'|'base64') {
  if(!id||id.includes('\\')||id.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid relative raw-data ID');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes>65536)throw new Error('Invalid raw-data byte pagination');
  if(encoding!=='utf8'&&encoding!=='base64')throw new Error('Encoding must be explicit');
  const root=rootFor(slug),path=resolve(root,id);
  if(!path.startsWith(root+sep))throw new Error('Raw-data path is outside the current user drive');
  let parent=root;
  for(const part of id.split('/').slice(0,-1)){parent=join(parent,part);if(!directory(parent))throw new Error('Raw-data directory missing');}
  const before=lstatSync(path);ordinary(before);
  if(version(before)!==expectedVersion)throw new Error('Raw-data file changed; list again before reading');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const opened=fstatSync(fd);ordinary(opened);
    if(version(opened)!==expectedVersion)throw new Error('Raw-data file changed while opening');
    if(offset>opened.size)throw new Error('Offset exceeds raw-data size');
    const buffer=Buffer.alloc(Math.min(maxBytes,opened.size-offset));
    const count=readSync(fd,buffer,0,buffer.length,offset);const bytes=buffer.subarray(0,count);
    let content:string,consumed=count;
    if(encoding==='base64')content=bytes.toString('base64');
    else {
      content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes,{stream:offset+count<opened.size});
      consumed=Buffer.byteLength(content,'utf8');
      if(count>0&&consumed===0)throw new Error('No complete UTF-8 text; request base64 for original bytes');
    }
    if(version(fstatSync(fd))!==expectedVersion)throw new Error('Raw-data file changed while reading');
    return {...describe(id,opened),encoding,offset,bytes_read:consumed,next_offset:offset+consumed<opened.size?offset+consumed:null,sha256:createHash('sha256').update(bytes.subarray(0,consumed)).digest('hex'),content};
  }finally{closeSync(fd);}
}
