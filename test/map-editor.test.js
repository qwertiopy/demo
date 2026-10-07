import test from 'node:test';
import assert from 'node:assert/strict';
import {createMap,put,line,fill,toLevel,fromLevel} from '../js/editor/model.js';
test('painted map round-trips through playable level JSON',()=>{
 const m=createMap(16,12);m.base.invincibility=true;m.base.player.upgrades={variationLuck:2};
 line(0,4,15,4,(x,y)=>put(m,x,y,1));put(m,3,7,3);put(m,5,7,4);put(m,7,7,5);
 const level=toLevel(m);assert.equal(level.seed,undefined);assert.equal(level.walls.length,1);assert.equal(level.walls[0].width,16);
 assert.deepEqual(fromLevel(level).cells,m.cells);assert.equal(level.player.upgrades.variationLuck,2);assert.equal(level.invincibility,true);
});
test('flood fill stays inside walls and player placement is unique',()=>{
 const m=createMap(8,8);line(0,3,7,3,(x,y)=>put(m,x,y,1));fill(m,0,5,4);
 assert.equal(m.cells[0],0);assert.equal(m.cells[7*8],4);assert.equal(m.cells[3*8],1);
 put(m,2,2,2);assert.equal(m.cells.filter(x=>x===2).length,1);assert.equal(m.cells[9],0);
});
test('invalid imports fail instead of silently clipping or converting maps',()=>{
 assert.throws(()=>fromLevel({seed:123}));assert.throws(()=>fromLevel({walls:[{x:-1,y:1,width:1,height:1}]}));
 assert.throws(()=>fromLevel({walls:[{x:0,y:0,width:1.2,height:1}]}));
 assert.throws(()=>fromLevel({editor:{width:5,height:5},walls:[{x:4,y:0,width:2,height:1}]}));
 assert.throws(()=>fromLevel({enemySpawns:[{x:1,y:1,type:'unknown'}]}));
 const m=createMap();m.cells.fill(0);assert.throws(()=>toLevel(m),/player spawn/);
});
