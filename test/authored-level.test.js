import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.document={getElementById(){return {getContext(){return {};},addEventListener(){}};}};
globalThis.window={focus(){}};
const {CombatDefaults}=await import('../js/combat/defaults.js');
Object.assign(CombatDefaults,JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../js/combat/defaults.json',import.meta.url),'utf8')));
const {loadLevel}=await import('../js/input.js');
const {updateGame}=await import('../js/runtime/game-update.js');
const {GameState,player}=await import('../js/state.js');
test('authored maps retain distant walls and spawns and never generate corridor columns',()=>{
 loadLevel({player:{spawn:{x:1,y:1},maximumProjectileCount:50},enemySpawnRate:0,walls:[{x:200,y:1,width:1,height:1}],enemySpawns:[{x:210,y:2,type:'g-bot'}]});
 assert.equal(GameState.proceduralLevel,false);player.hp=10;
 updateGame(1000,1/60);
 assert.equal(GameState.walls.length,1);assert.equal(GameState.walls[0].x,200);assert.equal(GameState.enemySpawns.length,1);assert.equal(GameState.generatedColumns.size,0);
});
