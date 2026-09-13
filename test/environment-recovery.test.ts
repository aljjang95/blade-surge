import {expect,test} from 'bun:test';
import {Mesh,MeshStandardMaterial,Scene,Texture} from 'three';
import {rebindEnvironment} from '../src/engine/environment.js';

test('restoring both live and template materials keeps later hero spawns on the new environment',()=>{
  const previous=new Texture(),next=new Texture(),custom=new Texture();
  const source=new MeshStandardMaterial({envMap:previous});
  const template=new Scene(),live=new Scene();
  template.add(new Mesh(undefined,[source,new MeshStandardMaterial({envMap:custom})]));
  const current=source.clone();live.add(new Mesh(undefined,current));
  for(const root of [live,template])rebindEnvironment(root,previous,next);
  expect(current.envMap).toBe(next);expect(source.clone().envMap).toBe(next);
  expect(((template.children[0] as Mesh).material as MeshStandardMaterial[])[1].envMap).toBe(custom);
});
