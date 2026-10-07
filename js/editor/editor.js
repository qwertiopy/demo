import {TILES,createMap,put,line,fill,toLevel,fromLevel} from './model.js';
import {readLaunchOptions,writeLaunchOptions} from '../launch-options.js';
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d'),viewport=$('viewport');
const KEY='theGameMapDraft';
let map=createMap(),tool='pencil',tile=1,zoom=16,ox=0,oy=0,gesture=null,selection=null,clipboard=null,space=false,hover={x:0,y:0},dirty=false;
const undo=[],redo=[];
const names={pencil:'Pencil',eraser:'Eraser',fill:'Fill',line:'Line',rectangle:'Rectangle',ellipse:'Ellipse',picker:'Pick tile',select:'Select',pan:'Pan'};
const shortcuts={b:'pencil',e:'eraser',f:'fill',l:'line',r:'rectangle',o:'ellipse',i:'picker',m:'select',h:'pan'};
function status(s){$('status').textContent=s;}
function snapshot(){return structuredClone(map);}
function setDirty(){dirty=true;}
function commit(before){if(JSON.stringify(before)===JSON.stringify(map))return;undo.push(before);if(undo.length>60)undo.shift();redo.length=0;setDirty();render();}
function history(back){cancel();const source=back?undo:redo,target=back?redo:undo;if(!source.length)return;target.push(snapshot());map=source.pop();selection=null;setDirty();render();}
function chooseTool(t){cancel();tool=t;selection=null;render();}
for(const [id,label] of Object.entries(names)){const b=document.createElement('button');b.textContent=label;b.title=`${label} (${Object.keys(shortcuts).find(k=>shortcuts[k]===id)?.toUpperCase()})`;b.dataset.tool=id;b.onclick=()=>chooseTool(id);$('tools').append(b);}
TILES.forEach((t,i)=>{const b=document.createElement('button');const s=document.createElement('span');s.className='swatch';s.style.background=t.color;b.append(s,document.createTextNode(t.name));b.dataset.tile=i;b.onclick=()=>{tile=i;render();};$('palette').append(b);});
function render(){
 const w=viewport.clientWidth,h=viewport.clientHeight,dpr=window.devicePixelRatio||1;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(ox,oy);ctx.scale(zoom,zoom);
 ctx.fillStyle=TILES[0].color;ctx.fillRect(0,0,map.width,map.height);
 for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){const t=map.cells[y*map.width+x];if(!t)continue;ctx.fillStyle=TILES[t].color;ctx.fillRect(x,y,1,1);if(t>=2&&zoom>=14){ctx.fillStyle='#141820';ctx.font='bold .55px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t===2?'P':TILES[t].name[0].toUpperCase(),x+.5,y+.5);}}
 if($('grid').checked&&zoom>=8){ctx.strokeStyle='#ffffff0c';ctx.lineWidth=1/zoom;ctx.beginPath();for(let x=0;x<=map.width;x++){ctx.moveTo(x,0);ctx.lineTo(x,map.height);}for(let y=0;y<=map.height;y++){ctx.moveTo(0,y);ctx.lineTo(map.width,y);}ctx.stroke();}
 ctx.lineWidth=1/zoom;ctx.strokeStyle='#59616d';ctx.strokeRect(0,0,map.width,map.height);
 if(selection){ctx.strokeStyle='#9ac3ff';ctx.lineWidth=1.5/zoom;ctx.setLineDash([5/zoom,3/zoom]);ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);ctx.setLineDash([]);}
 ctx.restore();
 document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));document.querySelectorAll('[data-tile]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.tile)===tile));
 $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;canvas.style.cursor=space||tool==='pan'?'grab':'crosshair';
}
function fit(){zoom=Math.max(1,Math.min((viewport.clientWidth-64)/map.width,(viewport.clientHeight-64)/map.height,32));ox=(viewport.clientWidth-map.width*zoom)/2;oy=(viewport.clientHeight-map.height*zoom)/2;render();}
function local(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function cell(e){const p=local(e);return{x:Math.max(-256,Math.min(512,Math.floor((p.x-ox)/zoom))),y:Math.max(-256,Math.min(512,Math.floor((p.y-oy)/zoom)))};}
function inside(p){return p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height;}
function brush(x,y,value){const size=value===2?1:Math.max(1,Math.min(16,Math.floor(Number($('size').value)||1)));for(let j=0;j<size;j++)for(let i=0;i<size;i++)put(map,x+i-Math.floor((size-1)/2),y+j-Math.floor((size-1)/2),value);}
function bounds(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x)+1,h:Math.abs(b.y-a.y)+1};}
function selected(p){return selection&&p.x>=selection.x&&p.x<selection.x+selection.w&&p.y>=selection.y&&p.y<selection.y+selection.h;}
function copy(){if(!selection)return;const s=selection;clipboard={w:s.w,h:s.h,cells:[]};for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)clipboard.cells.push(map.cells[(s.y+y)*map.width+s.x+x]);status('Selection copied');}
function stamp(data,x,y){for(let j=0;j<data.h;j++)for(let i=0;i<data.w;i++)put(map,x+i,y+j,data.cells[j*data.w+i]);}
function eraseSelection(){if(!selection)return;for(let y=selection.y;y<selection.y+selection.h;y++)for(let x=selection.x;x<selection.x+selection.w;x++)put(map,x,y,0);}
function cancel(){if(gesture?.before)map=gesture.before;gesture=null;render();}
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=e=>{
 if(gesture||![0,1,2].includes(e.button))return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);const p=cell(e);hover=p;
 if(space||tool==='pan'||e.button===1){gesture={kind:'pan',start:local(e),ox,oy};return;}
 if(!inside(p))return;
 if(tool==='picker'&&e.button!==2){tile=map.cells[p.y*map.width+p.x];render();return;}
 const kind=e.button===2?'eraser':tool,value=kind==='eraser'?0:tile;
 const before=snapshot();gesture={kind,before,start:p,last:p,value};
 if(kind==='fill'){fill(map,p.x,p.y,value);gesture=null;commit(before);}
 else if(kind==='select'){
  if(selected(p)){copy();gesture.data=structuredClone(clipboard);gesture.selection={...selection};gesture.kind='move';}
  else selection={x:p.x,y:p.y,w:1,h:1};
 }else if(kind==='pencil'||kind==='eraser')brush(p.x,p.y,value);
 else if(['line','rectangle','ellipse'].includes(kind))canvas.onpointermove(e);
 render();
};
canvas.onpointermove=e=>{
 const p=cell(e);hover=p;status(`${map.width} × ${map.height} · ${p.x}, ${p.y}${dirty?' · Unsaved':''}`);
 if(!gesture)return;const g=gesture;
 if(g.kind==='pan'){const q=local(e);ox=g.ox+q.x-g.start.x;oy=g.oy+q.y-g.start.y;render();return;}
 if(g.kind==='pencil'||g.kind==='eraser')line(g.last.x,g.last.y,p.x,p.y,(x,y)=>brush(x,y,g.value));
 else if(g.kind==='select'){selection=bounds(g.start,{x:Math.max(0,Math.min(map.width-1,p.x)),y:Math.max(0,Math.min(map.height-1,p.y))});}
 else{
  map=structuredClone(g.before);
  if(g.kind==='move'){selection=g.selection;eraseSelection();const x=Math.max(0,Math.min(map.width-g.data.w,g.selection.x+p.x-g.start.x)),y=Math.max(0,Math.min(map.height-g.data.h,g.selection.y+p.y-g.start.y));stamp(g.data,x,y);selection={x,y,w:g.data.w,h:g.data.h};}
  else if(g.kind==='line')line(g.start.x,g.start.y,p.x,p.y,(x,y)=>brush(x,y,g.value));
  else{const b=bounds(g.start,p),solid=$('solid').checked;
   for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++){
    let paint;
    if(g.kind==='rectangle')paint=solid||x===b.x||y===b.y||x===b.x+b.w-1||y===b.y+b.h-1;
    else{const rx=b.w/2,ry=b.h/2,cx=b.x+rx-.5,cy=b.y+ry-.5;const inEllipse=(a,c)=>((a-cx)/rx)**2+((c-cy)/ry)**2<=1;paint=inEllipse(x,y)&&(solid||!inEllipse(x+1,y)||!inEllipse(x-1,y)||!inEllipse(x,y+1)||!inEllipse(x,y-1));}
    if(paint)put(map,x,y,g.value);
   }
  }
 }
 g.last=p;render();
};
canvas.onpointerup=e=>{if(!gesture)return;const g=gesture;gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(g.before&&g.kind!=='select')commit(g.before);render();};
canvas.onpointercancel=()=>cancel();canvas.onlostpointercapture=()=>{if(gesture)cancel();};
function scale(factor,p={x:viewport.clientWidth/2,y:viewport.clientHeight/2}){const next=Math.min(80,Math.max(1,zoom*factor));ox=p.x-(p.x-ox)*next/zoom;oy=p.y-(p.y-oy)*next/zoom;zoom=next;render();}
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!gesture)scale(e.deltaY<0?1.15:1/1.15,local(e));},{passive:false});
$('in').onclick=()=>scale(1.25);$('out').onclick=()=>scale(.8);$('fit').onclick=fit;$('grid').onchange=render;
$('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
function save(){const level=toLevel(map);localStorage.setItem(KEY,JSON.stringify(level));writeLaunchOptions({gameModeId:'sandbox',level});dirty=false;status('Saved');return level;}
function action(fn){try{fn();}catch(e){status(e.message);}}
$('save').onclick=()=>action(save);
$('play').onclick=()=>action(()=>{save();location.href='index.html?mode=sandbox';});
$('export').onclick=()=>action(()=>{const data=JSON.stringify(toLevel(map),null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='level.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported level.json');});
$('new').onclick=()=>$('newDialog').showModal();
$('create').onclick=e=>{e.preventDefault();action(()=>{const next=createMap(Number($('width').value),Number($('height').value)),before=snapshot();map=next;selection=null;commit(before);$('newDialog').close();fit();});};
$('help').onclick=()=>$('helpDialog').showModal();
$('open').onclick=()=>$('file').click();
$('file').onchange=async()=>{const f=$('file').files[0];$('file').value='';if(!f)return;try{if(f.size>8*1024*1024)throw Error('File is too large (8 MB maximum).');const next=fromLevel(JSON.parse(await f.text()));cancel();const before=snapshot();map=next;selection=null;commit(before);fit();status(`Opened ${f.name}`);}catch(e){status(e.message);}};
window.onkeydown=e=>{
 if(e.target.matches('input,textarea')||document.querySelector('dialog[open]'))return;
 const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
 if(key===' '){e.preventDefault();space=true;render();return;}
 if(key==='escape'){cancel();selection=null;render();return;}
 if(gesture)return;
 if(mod){if(['z','y','c','v','s'].includes(key))e.preventDefault();
  if(key==='z')history(!e.shiftKey);if(key==='y')history(false);if(key==='s')action(save);if(key==='c')copy();
  if(key==='v'&&clipboard){const before=snapshot();const x=Math.max(0,Math.min(map.width-clipboard.w,hover.x)),y=Math.max(0,Math.min(map.height-clipboard.h,hover.y));stamp(clipboard,x,y);selection={x,y,w:Math.min(map.width,clipboard.w),h:Math.min(map.height,clipboard.h)};tool='select';commit(before);}return;
 }
 if(shortcuts[key])chooseTool(shortcuts[key]);
 if((key==='delete'||key==='backspace')&&selection){e.preventDefault();const before=snapshot();eraseSelection();selection=null;commit(before);}
};
window.onkeyup=e=>{if(e.key===' '){space=false;render();}};
window.addEventListener('blur',()=>{space=false;cancel();});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{const saved=localStorage.getItem(KEY),level=readLaunchOptions().level;if(saved)map=fromLevel(JSON.parse(saved));else if(level&&level.seed===undefined)map=fromLevel(level);}catch(e){status(`Could not restore map: ${e.message}`);}
new ResizeObserver(render).observe(viewport);fit();
