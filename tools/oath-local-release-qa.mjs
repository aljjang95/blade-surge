// Reuse the normal release checker against an ephemeral loopback preview.
import {preview} from 'vite';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const server=await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
try{
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const child=spawn(process.execPath,[path.join(root,'tools/live-release-qa.mjs'),head,origin],{cwd:root,stdio:'inherit',shell:false});
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});
 if(exit!==0)throw Error('Local release QA failed with code '+exit);
}finally{await new Promise(r=>server.httpServer.close(r));}
