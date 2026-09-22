// 수동 편집과 자동 내보내기가 공유하는 로컬 Blender 실행 어댑터.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const binary=process.env.BLENDER_BIN||path.join(os.homedir(),'AppData/Local/Programs/Blender-5.2.1-verified/blender-5.2.1-windows-x64/blender.exe');
const dir=path.join(root,'work/studio'),args=process.argv.slice(2);
const defaultInput='art/frost-armor-v1/knight-rime.blend';
const childEnv={...process.env};
const envValue=name=>Object.entries(childEnv).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
if(process.platform==='win32'){
  if(!envValue('ProgramData'))childEnv.ProgramData='C:\\ProgramData';
  if(!envValue('ALLUSERSPROFILE'))childEnv.ALLUSERSPROFILE=envValue('ProgramData');
  if(!envValue('TMP')&&envValue('TEMP'))childEnv.TMP=envValue('TEMP');
}
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function contained(file,base=root){const relative=path.relative(base,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function inputPath(input){const file=fs.realpathSync(path.resolve(root,input));if(!contained(file,path.join(root,'art'))||path.extname(file).toLowerCase()!=='.blend')throw new Error('Input must be a saved .blend inside this project art folder');return file;}
function version(){if(!fs.existsSync(binary))throw new Error('Verified Blender executable missing; set BLENDER_BIN to its approved location');const p=spawnSync(binary,['--version'],{encoding:'utf8',timeout:15000,windowsHide:true,env:childEnv});if(p.status!==0)throw new Error('Blender version probe failed');const line=p.stdout.split(/\r?\n/)[0];if(!/^Blender 5\.2\.1(?:\s|$)/.test(line))throw new Error('Blender version changed; revalidation required: '+line);return line;}
let request={action:args[0]||'doctor',input:args[1]||defaultInput};
if(args[0]==='--request'){
  const file=fs.realpathSync(path.resolve(root,args[1]||''));
  if(!contained(file)||path.extname(file)!=='.json')throw new Error('Request must be a local project JSON file');
  request=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['action','input'].includes(k)))throw new Error('Only action and input are supported');
}
if(!['doctor','open','export'].includes(request.action))throw new Error('Supported actions: doctor, open, export');
if(request.input!==undefined&&typeof request.input!=='string')throw new Error('Input must be a relative file path');
fs.mkdirSync(dir,{recursive:true});
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const receipt={schema:'tll.blender-local-adapter/v1',runId,action:request.action,root,binary,version:version(),noAutoexec:true,production:false};
const save=()=>fs.writeFileSync(path.join(dir,'last-'+request.action+'.json'),JSON.stringify(receipt,null,2));
if(!contained(fs.realpathSync(dir)))throw new Error('Output folder must remain in the project');
if(request.action==='doctor'){
  const probe=path.join(dir,'write-probe-'+runId+'.txt'),text='Blender local adapter write/read check\n';
  fs.writeFileSync(probe,text,{flag:'wx'});receipt.writeReadPassed=fs.readFileSync(probe,'utf8')===text;
  receipt.blenderSha256=sha(binary);receipt.defaultSourceExists=fs.existsSync(path.join(root,defaultInput));
  receipt.passed=receipt.writeReadPassed&&receipt.defaultSourceExists;save();
}else{
  const source=inputPath(request.input||defaultInput),before=sha(source);receipt.source=source;receipt.sourceSha256=before;
  if(request.action==='open'){
    const backups=path.join(dir,'source-backups');fs.mkdirSync(backups,{recursive:true});
    const backup=path.join(backups,before+'.blend');if(!fs.existsSync(backup))fs.copyFileSync(source,backup,fs.constants.COPYFILE_EXCL);
    if(sha(backup)!==before)throw new Error('Source backup verification failed');receipt.backup=backup;
    const logPath=path.join(dir,'open-'+runId+'.log'),log=fs.openSync(logPath,'wx'); receipt.log=logPath; const child=spawn(binary,['--disable-autoexec',source],{cwd:root,stdio:['ignore',log,log],windowsHide:false,detached:true,env:childEnv}); fs.closeSync(log);
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    await new Promise(resolve=>setTimeout(resolve,3000)); if(child.exitCode!==null||child.signalCode){receipt.launched=false;receipt.exitCode=child.exitCode;save();throw new Error('Blender UI exited during startup; inspect '+logPath);} receipt.pid=child.pid;receipt.launched=true;receipt.visualVerification='not performed by this command';child.unref();save();
  }else{
    const runDir=path.join(dir,'exports',runId);fs.mkdirSync(runDir,{recursive:true});
    const output=path.join(runDir,path.basename(source,'.blend')+'.glb'),proof=path.join(runDir,'export-proof.json');
    const log=fs.openSync(path.join(runDir,'blender.log'),'wx');
    let processResult;
    try{processResult=spawnSync(binary,['--background','--disable-autoexec','--factory-startup',source,'--python-exit-code','1','--python',path.join(root,'tools/studio/blender-export.py'),'--','--output',output,'--receipt',proof],{cwd:root,stdio:['ignore',log,log],timeout:120000,windowsHide:true,env:childEnv});}
    finally{fs.closeSync(log);}
    receipt.exitCode=processResult.status;receipt.log=path.join(runDir,'blender.log');
    if(processResult.status!==0||!fs.existsSync(proof)){receipt.passed=false;save();throw new Error('Blender export failed; inspect '+receipt.log);}
    const validation=JSON.parse(fs.readFileSync(proof,'utf8'));
    receipt.passed=validation.passed&&validation.reimport_verified&&sha(source)===before&&sha(output)===validation.output_sha256;
    receipt.output=output;receipt.proof=proof;receipt.validation=validation;save();
    if(!receipt.passed)throw new Error('Export verification failed');
  }
}
console.log(JSON.stringify(receipt,null,2));
if(receipt.passed===false)process.exitCode=1;
