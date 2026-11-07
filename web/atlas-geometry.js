// Procedural meshes are requested only by the explicitly labelled demo mode.
// All vertices and markers use a shared scene coordinate system.
// Visual reference (not copied): NASA Hubble NGC 3430 and NASA's Earth photo book.
import { galaxySprites } from './atlas-galaxy.js';
// These are display-only conversions; the source light-year coordinates and
// distance calculations remain untouched in the data adapter.
const UNIVERSE_DISPLAY_DIVISOR = 35000;
const UNIVERSE_GALAXY_SCALE = .75;
const SELECTED_GALAXY_SCALE = 2.4;
const rad = d => d * Math.PI / 180;
function vertex(lat,lon,r) { const a=rad(lat), b=rad(lon); return [r*Math.cos(a)*Math.cos(b),r*Math.sin(a),r*Math.cos(a)*Math.sin(b)]; }
const unit = p => { const r=Math.hypot(...p)||1;return p.map(v=>v/r); };
const flatten = a => new Float32Array(a.flat());
function mesh(vertices,normals,color) { return { positions:flatten(vertices), normals:flatten(normals), color }; }
function sphere(color, r=1, density='standard') {
  const w=density==='high'?48:32, h=density==='high'?24:16, p=[],n=[];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const a=-90+180*y/h,b=-90+180*(y+1)/h,c=360*x/w,d=360*(x+1)/w;
    const v=[vertex(a,c,r),vertex(b,c,r),vertex(b,d,r),vertex(a,c,r),vertex(b,d,r),vertex(a,d,r)];
    for(const q of v) {p.push(q);n.push(unit(q));}
  }
  return mesh(p,n,color);
}
function land(continents, color, r=2.74, density='standard') {
  const w=density==='high'?120:72,h=density==='high'?60:36,p=[],n=[];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const a=-90+180*y/h,b=-90+180*(y+1)/h,c=360*x/w,d=360*(x+1)/w;
    const mid=unit(vertex((a+b)/2,(c+d)/2,1));
    const isLand=continents.some(q=>{const anchor=unit(vertex(q.lat,q.lon,1));const angle=Math.acos(Math.max(-1,Math.min(1,mid.reduce((v,n,i)=>v+n*anchor[i],0))))*180/Math.PI;return angle<q.radius*(1+0.11*Math.sin(rad(c*3+a*2)));});
    if(!isLand)continue;
    for(const q of [vertex(a,c,r),vertex(b,c,r),vertex(b,d,r),vertex(a,c,r),vertex(b,d,r),vertex(a,d,r)]){p.push(q);n.push(unit(q));}
  }
  return mesh(p,n,color);
}
function rgba(hex, alpha) {
  const m=/^#([0-9a-f]{6})$/i.exec(hex || '');
  return m ? [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).concat(alpha) : [1,1,1,alpha];
}
// An illustrative globe, never applied to actual archive objects. Layered
// spherical patches are deterministic so the view doesn't change on redraw.
function earthLikeLayers(planet,density) {
  const visual=planet.earthLike, w=density==='high'?144:96,h=density==='high'?72:48;
  const groups=Array.from({length:4},()=>({p:[],n:[]}));
  const centers=(planet.continents||[]).map(q=>({...q,axis:unit(vertex(q.lat,q.lon,1))}));
  const add=(g,a,b,c,d,r)=>{for(const q of [vertex(a,c,r),vertex(b,c,r),vertex(b,d,r),vertex(a,c,r),vertex(b,d,r),vertex(a,d,r)]){g.p.push(q);g.n.push(unit(q));}};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const a=-90+180*y/h,b=-90+180*(y+1)/h,c=360*x/w,d=360*(x+1)/w, lat=(a+b)/2,lon=(c+d)/2;
    const mid=unit(vertex(lat,lon,1));
    const noise=.18*Math.sin(rad(lon*7+lat*3))+.10*Math.cos(rad(lat*11-lon*5))+.07*Math.sin(rad(lon*17+lat*9));
    const inside=centers.some(q=>{const angle=Math.acos(Math.max(-1,Math.min(1,mid.reduce((v,n,i)=>v+n*q.axis[i],0))))*180/Math.PI;return angle<q.radius*(.92+noise);});
    if(Math.abs(lat)>71) add(groups[2],a,b,c,d,2.735);
    else if(inside) add(groups[(Math.sin(rad(lon*4+lat*8))+.5*Math.cos(rad(lon*9-lat*5))>.48)?1:0],a,b,c,d,2.735);
    const swirl=Math.sin(rad(lon*3+lat*6+35*Math.sin(rad(lon*2))))+.55*Math.cos(rad(lat*12-lon*4));
    if(swirl>1.02) add(groups[3],a,b,c,d,2.785);
  }
  return [mesh(groups[0].p,groups[0].n,visual.biomeGreen),mesh(groups[1].p,groups[1].n,visual.biomeBrown),mesh(groups[2].p,groups[2].n,visual.iceColor),mesh(groups[3].p,groups[3].n,rgba(visual.cloudColor,visual.cloudOpacity)),sphere(rgba(visual.atmosphereColor,visual.atmosphereOpacity),2.82,density)];
}
function terrain(color='#668555') {
  const p=[],n=[],steps=22;
  const height=(x,z)=>-.95+.17*Math.sin(x*1.6)*Math.cos(z*1.2)+.07*Math.cos((x+z)*2.1);
  for(let i=0;i<steps;i++)for(let j=0;j<steps;j++){
    const x=-5+10*i/steps,X=-5+10*(i+1)/steps,z=-5+10*j/steps,Z=-5+10*(j+1)/steps;
    const points=[[x,height(x,z),z],[X,height(X,z),z],[X,height(X,Z),Z],[x,height(x,z),z],[X,height(X,Z),Z],[x,height(x,Z),Z]];
    for(const q of points){p.push(q);n.push([0,1,0]);}
  }
  return mesh(p,n,color);
}
function box(x,z,width,height,color) {
  const y=-.8, X=x+width, Z=z+width, Y=y+height,p=[],n=[];
  const add=(a,b,c,d,normal)=>{for(const q of [a,b,c,a,c,d]){p.push(q);n.push(normal);}};
  add([x,y,z],[X,y,z],[X,Y,z],[x,Y,z],[0,0,-1]);
  add([X,y,Z],[x,y,Z],[x,Y,Z],[X,Y,Z],[0,0,1]);
  add([x,y,Z],[x,y,z],[x,Y,z],[x,Y,Z],[-1,0,0]);
  add([X,y,z],[X,y,Z],[X,Y,Z],[X,Y,z],[1,0,0]);
  add([x,Y,z],[X,Y,z],[X,Y,Z],[x,Y,Z],[0,1,0]);
  return mesh(p,n,color);
}
export function buildDemoScene({type, objects=[], visual={}, density='standard', surfaceKind='city'}) {
  const meshes=[],pointSprites=[]; let markers=objects.map(o=>({...o}));
  if(type==='universe') {
    markers=markers.map(o=>({...o,x:o.x/UNIVERSE_DISPLAY_DIVISOR,y:o.y/UNIVERSE_DISPLAY_DIVISOR,z:o.z/UNIVERSE_DISPLAY_DIVISOR}));
    for(const o of markers)pointSprites.push(galaxySprites(o.visual?.galaxyShape||'disk',[o.x,o.y,o.z],UNIVERSE_GALAXY_SCALE,density));
  } else if(type==='galaxy') {
    // Same seed, shape and colours as its universe view, only re-centred and
    // magnified: no independently generated representation is substituted.
    pointSprites.push(galaxySprites(visual.galaxyShape||'disk',[0,0,0],SELECTED_GALAXY_SCALE,density));
  } else if(type==='planet') {
    const planet=visual.planet||{};
    meshes.push(sphere(planet.oceanColor||'#397ea0',2.7,density));
    if(planet.earthLike) meshes.push(...earthLikeLayers(planet,density));
    else meshes.push(land(planet.continents||[],planet.landColor||'#87a85d',2.73,density));
    markers=markers.map(o=>({...o,x:o.x*2.77/4.57,y:o.y*2.77/4.57,z:o.z*2.77/4.57}));
  } else if(type==='surface') {
    markers=[];
    const region=visual.region||{};
    meshes.push(terrain(region.terrainColor));
    // Illustrative buildings, never derived from any archive record.
    if(surfaceKind==='city') for(let i=0;i<12;i++) { const x=((i*7)%9-4)*.65,z=((i*11)%9-4)*.65; meshes.push(box(x,z,.22,.35+(i%4)*.2,'#c7c7b5')); }
    for(const l of region.landmarks||[])meshes.push(box(l.x,l.z,.34,l.height||1,'#d4c3a0'));
  }
  return {type,objects:markers,meshes,pointSprites,...(type==='planet'?{occluder:{center:[0,0,0],radius:2.7}}:{})};
}
