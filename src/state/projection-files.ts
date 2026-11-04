import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {statSync} from 'node:fs';
import {resolveDataRoot} from 'utarus';
export function projectionLocation(userId:string) {
  const directory=join(resolveDataRoot(),'derived','portfolio');
  return {directory,file:join(directory,createHash('sha256').update(userId).digest('hex')+'.json')};
}
export function projectionFileSignature(file:string):string {
  const stat=statSync(file,{bigint:true});
  return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
}
