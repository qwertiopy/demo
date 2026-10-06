export const TILES = [
 {name:'Empty', color:'#20242b'}, {name:'Wall', color:'#a5aebc'},
 {name:'Player', color:'#6daaff'}, {name:'g-bot', color:'#ec7f86'},
 {name:'j-bot', color:'#eabd70'}, {name:'h-bot', color:'#ba91e5'}
];
export function createMap(width=64,height=32) {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width>256||height>256) throw Error('Use whole dimensions between 2 and 256.');
 const map={width,height,cells:Array(width*height).fill(0),base:{player:{maximumProjectileCount:50},enemySpawnRate:1,minimumEnemySpawnDistanceBlocks:0,maximumEnemySpawnDistanceBlocks:1000}};
 map.cells[width+1]=2; return map;
}
export function put(map,x,y,tile) {
 if(x<0||y<0||x>=map.width||y>=map.height)return;
 if(tile===2)map.cells=map.cells.map(v=>v===2?0:v);
 map.cells[y*map.width+x]=tile;
}
export function line(x0,y0,x1,y1,paint) {
 const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let err=dx+dy;
 for(;;){paint(x0,y0);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
}
export function fill(map,x,y,tile){
 if(x<0||y<0||x>=map.width||y>=map.height)return;
 if(tile===2){put(map,x,y,tile);return;}
 const old=map.cells[y*map.width+x];if(old===tile)return;
 const todo=[[x,y]];while(todo.length){const [a,b]=todo.pop();if(a<0||b<0||a>=map.width||b>=map.height||map.cells[b*map.width+a]!==old)continue;put(map,a,b,tile);todo.push([a+1,b],[a-1,b],[a,b+1],[a,b-1]);}
}
export function toLevel(map){
 const level=structuredClone(map.base);delete level.seed;
 level.walls=[];level.enemySpawns=[];level.editor={width:map.width,height:map.height};
 level.player={...level.player};delete level.playerSpawn;
 const p=map.cells.indexOf(2);if(p<0)throw Error('Place a player spawn before exporting or playing.');
 level.player.spawn={x:p%map.width,y:Math.floor(p/map.width)};
 for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
  const tile=map.cells[y*map.width+x];
  if(tile===1){const start=x;while(x+1<map.width&&map.cells[y*map.width+x+1]===1)x++;level.walls.push({x:start,y,width:x-start+1,height:1,color:'slategray'});}
  else if(tile>=3)level.enemySpawns.push({x,y,type:TILES[tile].name});
 }return level;
}
export function fromLevel(level){
 if(!level||typeof level!=='object'||Array.isArray(level))throw Error('Expected a level JSON object.');
 if(level.seed!==undefined)throw Error('This is a procedural level. Create a new map to draw an authored level.');
 const walls=level.walls??[],spawns=level.enemySpawns??[],p=level.player?.spawn??level.playerSpawn;
 if(!Array.isArray(walls)||!Array.isArray(spawns))throw Error('Invalid walls or spawns.');
 const points=[...walls,...spawns,...(p?[p]:[])];
 for(const v of points)if(!Number.isInteger(v.x)||!Number.isInteger(v.y)||v.x<0||v.y<0||v.x>255||v.y>255)throw Error('The pixel editor supports non-negative whole-cell coordinates up to 255.');
 for(const w of walls)if(!Number.isInteger(w.width)||!Number.isInteger(w.height)||w.width<1||w.height<1)throw Error('Walls must have positive whole-cell dimensions.');
 for(const s of spawns)if(!TILES.slice(3).some(t=>t.name===(s.type||'g-bot')))throw Error('Unsupported enemy type.');
 const width=level.editor?.width??Math.max(64,...points.map(v=>v.x+(v.width??1)));
 const height=level.editor?.height??Math.max(32,...points.map(v=>v.y+(v.height??1)));
 const map=createMap(width,height);map.cells.fill(0);map.base=structuredClone(level);
 for(const v of points)if(v.x+(v.width??1)>width||v.y+(v.height??1)>height)throw Error('Map content lies outside its dimensions.');
 for(const w of walls)for(let y=w.y;y<w.y+w.height;y++)for(let x=w.x;x<w.x+w.width;x++)put(map,x,y,1);
 for(const s of spawns){if(map.cells[s.y*width+s.x])throw Error('Overlapping tiles cannot be edited losslessly.');put(map,s.x,s.y,TILES.findIndex(t=>t.name===(s.type||'g-bot')));}
 if(p){if(map.cells[p.y*width+p.x])throw Error('Player overlaps another tile.');put(map,p.x,p.y,2);}return map;
}
