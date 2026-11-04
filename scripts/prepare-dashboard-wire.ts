/** Prepare lossless transport files from committed saved views while the live service runs. */
import {isAbsolute,join} from 'node:path';
import {readdirSync} from 'node:fs';
import {prepareDashboardWireFile} from '../src/state/dashboard-wire-store.js';
if(!process.env.UTARUS_DATA_ROOT || !isAbsolute(process.env.UTARUS_DATA_ROOT))throw new Error('An absolute UTARUS_DATA_ROOT is required');
const directory=join(process.env.UTARUS_DATA_ROOT,'derived','portfolio');
const files=readdirSync(directory).filter(file=>/^[a-f0-9]{64}\.json$/.test(file));
const started=Date.now();
for(const file of files)await prepareDashboardWireFile(join(directory,file));
console.log(JSON.stringify({operation:'prepare-dashboard-wire',prepared:files.length,elapsedMs:Date.now()-started,status:'succeeded'}));
