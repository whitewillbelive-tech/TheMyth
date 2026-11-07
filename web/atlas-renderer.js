// The viewer receives ephemeral geometry only and never writes archive data.
export function createRenderer(canvas, { onSelect = () => {}, onStatus = () => {}, onLabels = () => {}, onHover = () => {}, onLineSelect = () => {}, onLineHover = () => {} } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) throw new Error('WebGL2를 사용할 수 없습니다. 목록으로 계속 탐색할 수 있습니다.');
  function shader(type, code) {
    const s=gl.createShader(type); gl.shaderSource(s,code); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s)||'셰이더 컴파일 실패';gl.deleteShader(s);throw new Error(msg);}
    return s;
  }
  function program(vs,fs) {
    let v, f, p;
    try { v=shader(gl.VERTEX_SHADER,vs); f=shader(gl.FRAGMENT_SHADER,fs); p=gl.createProgram(); gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)||'그래픽 초기화 실패'); return p;
    } catch(error){if(p)gl.deleteProgram(p);throw error;}
    finally{if(v)gl.deleteShader(v);if(f)gl.deleteShader(f);}
  }
  const meshProgram=program(`#version 300 es
    precision highp float; layout(location=0) in vec3 pos; layout(location=1) in vec3 normal;
    uniform mat4 vp; uniform mat4 model; out vec3 n;
    void main(){ gl_Position=vp*model*vec4(pos,1.); n=mat3(transpose(inverse(model)))*normal; }`,
    `#version 300 es
    precision highp float; in vec3 n; uniform vec4 color; out vec4 frag;
    void main(){float light=.32+.68*max(dot(normalize(n),normalize(vec3(-.45,.8,.55))),0.); frag=vec4(color.rgb*light,color.a);}`);
  let pointProgram;
  try { pointProgram=program(`#version 300 es
    precision highp float; layout(location=0) in vec3 pos; layout(location=1) in vec4 color; layout(location=2) in float size;
    out vec4 c; void main(){ gl_Position=vec4(pos,1.);gl_PointSize=size;c=color; }`,
    `#version 300 es
    precision highp float; in vec4 c; out vec4 frag;
    void main(){float d=length(gl_PointCoord-vec2(.5))*2.; float a=1.-smoothstep(.3,1.,d);if(a<.01)discard;frag=vec4(c.rgb,c.a*a);}`);
  } catch(e){gl.deleteProgram(meshProgram);throw e;}
  let spriteProgram;
  try { spriteProgram=program(`#version 300 es
    precision highp float; layout(location=0) in vec3 pos; layout(location=1) in vec4 color; layout(location=2) in float size;
    uniform mat4 vp; uniform float pixelRatio; out vec4 c;
    void main(){gl_Position=vp*vec4(pos,1.);gl_PointSize=size*pixelRatio;c=color;}`,
    `#version 300 es
    precision highp float; in vec4 c; out vec4 frag;
    void main(){float d=length(gl_PointCoord-vec2(.5))*2.;float a=1.-smoothstep(.05,1.,d);if(a<.01)discard;frag=vec4(c.rgb,c.a*a);}`);
  } catch(e){gl.deleteProgram(pointProgram);gl.deleteProgram(meshProgram);throw e;}
  let lineProgram;
  try {lineProgram=program(`#version 300 es
    precision highp float; layout(location=0) in vec3 pos; layout(location=1) in vec4 color;
    out vec4 c; void main(){gl_Position=vec4(pos,1.);c=color;}`,
    `#version 300 es
    precision highp float; in vec4 c;out vec4 frag;void main(){frag=c;}`);
  }catch(e){gl.deleteProgram(spriteProgram);gl.deleteProgram(pointProgram);gl.deleteProgram(meshProgram);throw e;}
  const lineVao=gl.createVertexArray(),lineBuffer=gl.createBuffer();
  gl.bindVertexArray(lineVao);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer);
  for(const [loc,n,offset] of [[0,3,0],[1,4,3]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,28,offset*4);}
  gl.bindVertexArray(null);
  const pointVao=gl.createVertexArray(), pointBuffer=gl.createBuffer();
  gl.bindVertexArray(pointVao);gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);
  for(const [loc,n,offset] of [[0,3,0],[1,4,3],[2,1,7]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,32,offset*4);}
  gl.bindVertexArray(null);
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const multiply=(a,b)=>{const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;};
  const rotateY=a=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
  function view(eye){const f=norm(eye.map(v=>-v)),s=norm(cross(f,[0,1,0])),u=cross(s,f);return new Float32Array([s[0],u[0],-f[0],0,s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,-dot(s,eye),-dot(u,eye),dot(f,eye),1]);}
  function perspective(aspect){const f=1/Math.tan(Math.PI/8),near=.1,far=250;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);}
  function project(m,[x,y,z]){const w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=0)return null;return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w,w];}
  function color(value){if(Array.isArray(value)&&value.length>=3)return [...value.slice(0,3),value[3]??1];const m=typeof value==='string'&&value.match(/^#([0-9a-f]{6})$/i);return m?[...[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255),1]:[.56,.78,1,1];}
  let scene={type:'universe',objects:[],meshes:[],lines:[]},gpuMeshes=[],gpuSprites=[],density='standard',yaw=-.45,pitch=.25,distance=18,frame=0,lastFps=0,frames=0,down=null,projected=[],disposed=false,cameraTarget=null,focusOrigin=null,initialView={yaw:-.45,pitch:.25,distance:18},hoverId=null,hoverLineId=null,hoverPoint=null,lineSegments=[];
  const defaultDistance = type => ({universe:18,galaxy:13,planet:9.5,surface:11}[type] || 18);
  function freeMeshes(items=gpuMeshes){for(const m of items){gl.deleteVertexArray(m.vao);for(const b of m.buffers)gl.deleteBuffer(b);}if(items===gpuMeshes)gpuMeshes=[];}
  function uploadSprites(input){
    if(!input.positions || input.positions.length%3!==0)throw new Error('잘못된 입자 좌표');
    const count=input.positions.length/3;
    if(input.colors && input.colors.length!==count*4)throw new Error('잘못된 입자 색상');
    if(input.sizes && input.sizes.length!==count)throw new Error('잘못된 입자 크기');
    const data=new Float32Array(count*8), base=color(input.color);
    for(let i=0;i<count;i++){
      const off=i*8; data.set(input.positions.slice(i*3,i*3+3),off);
      data.set(input.colors?input.colors.slice(i*4,i*4+4):base,off+3);
      data[off+7]=input.sizes?input.sizes[i]:(input.size??3);
      for(let j=0;j<8;j++)if(!Number.isFinite(data[off+j]))throw new Error('입자 값이 유효하지 않습니다');
    }
    const vao=gl.createVertexArray(),b=gl.createBuffer();gl.bindVertexArray(vao);
    try{gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      for(const [loc,n,off] of [[0,3,0],[1,4,3],[2,1,7]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,32,off*4);}
      return {vao,buffers:[b],count};
    }catch(e){gl.deleteVertexArray(vao);gl.deleteBuffer(b);throw e;}finally{gl.bindVertexArray(null);}
  }
  function upload(m){
    const positions=m.positions, normals=m.normals;
    if(!positions || !normals || positions.length!==normals.length || positions.length%3!==0)throw new Error('잘못된 메시 정점 또는 법선');
    const vao=gl.createVertexArray(), buffers=[];gl.bindVertexArray(vao);
    try {for(const [loc,data] of [[0,positions],[1,normals]]){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data instanceof Float32Array?data:new Float32Array(data),gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
      let indexType=null,count=positions.length/3;
      if(m.indices){const idx=m.indices instanceof Uint16Array||m.indices instanceof Uint32Array?m.indices:new Uint32Array(m.indices);const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);indexType=idx instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT;count=idx.length;}
      return {vao,buffers,indexType,count,color:color(m.color),model:m.modelMatrix||identity()};
    }catch(e){gl.deleteVertexArray(vao);for(const b of buffers)gl.deleteBuffer(b);throw e;}finally{gl.bindVertexArray(null);}
  }
  function isOccluded(eye,p,occluder){if(!occluder || !Number.isFinite(occluder.radius)||occluder.radius<=0)return false;
    const c=occluder.center||[0,0,0], d=p.map((x,i)=>x-eye[i]), f=eye.map((x,i)=>x-c[i]);
    const a=dot(d,d),b=2*dot(f,d),cc=dot(f,f)-occluder.radius**2,disc=b*b-4*a*cc;
    if(a===0||disc<0)return false;const t=(-b-Math.sqrt(disc))/(2*a);return t>0&&t<.999;}
  function validateLines(lines){const ids=new Set(),valid=[];for(const line of Array.isArray(lines)?lines:[]){if(!line || typeof line.id!=='string' || !line.id || ids.has(line.id) || !Array.isArray(line.source) || !Array.isArray(line.target) || line.source.length!==3 || line.target.length!==3 || ![...line.source,...line.target].every(Number.isFinite) || line.source.every((n,i)=>n===line.target[i]))continue;ids.add(line.id);valid.push({...line,source:[...line.source],target:[...line.target]});}return valid;}
  function setHover(id){if(id===hoverId)return;hoverId=id;onHover(id);}
  function setLineHover(id){if(id===hoverLineId)return;hoverLineId=id;onLineHover(id);}
  function lineHit(x,y){let best=null,bestDist=7;for(const s of lineSegments){const dx=s.x2-s.x1,dy=s.y2-s.y1,den=dx*dx+dy*dy;const t=den?Math.max(0,Math.min(1,((x-s.x1)*dx+(y-s.y1)*dy)/den)):0;const d=Math.hypot(x-(s.x1+t*dx),y-(s.y1+t*dy));if(d<bestDist){best=s.id;bestDist=d;}}return best;}
  function clipSegment(x0,y0,x1,y1,w,h){let lo=0,hi=1;const dx=x1-x0,dy=y1-y0;for(const [p,q] of [[-dx,x0+8],[dx,w+8-x0],[-dy,y0+8],[dy,h+8-y0]]){if(p===0){if(q<0)return null;continue;}const r=q/p;if(p<0){if(r>hi)return null;lo=Math.max(lo,r);}else{if(r<lo)return null;hi=Math.min(hi,r);}}return [lo,hi];}
  function clipDepth(m,source,target){
    // Clip the world segment against homogeneous near and far planes before
    // dividing by w. This keeps the visible part when an endpoint is behind
    // the camera or outside the depth range.
    const clip=p=>[m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14],m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15]];
    let a=[...source],b=[...target];
    for(const sign of [1,-1]){const ca=clip(a),cb=clip(b),fa=ca[1]+sign*ca[0],fb=cb[1]+sign*cb[0];
      if(!Number.isFinite(fa)||!Number.isFinite(fb)||(fa<0&&fb<0))return null;
      if(fa<0||fb<0){const t=fa/(fa-fb),p=a.map((n,i)=>n+(b[i]-n)*t);if(fa<0)a=p;else b=p;}
    }
    return [a,b];
  }
  function makeLines(vp,eye,rect){
    const out=[];lineSegments=[];const palettes={open:'#67dbba',restricted:'#ffc768',closed:'#ef7c7c',unstable:'#c89dff',unknown:'#a8b6c5'};
    for(const line of scene.lines){
      const clippedWorld=clipDepth(vp,line.source,line.target);if(!clippedWorld)continue;const [source,target]=clippedWorld;
      const a=project(vp,source),b=project(vp,target);if(!a||!b)continue;
      const sx=(a[0]+1)*rect.width/2,sy=(1-a[1])*rect.height/2,tx=(b[0]+1)*rect.width/2,ty=(1-b[1])*rect.height/2;
      const full=Math.hypot(tx-sx,ty-sy);if(!Number.isFinite(full)||full<.01)continue;
      const clipped=clipSegment(sx,sy,tx,ty,rect.width,rect.height);if(!clipped)continue;
      const start=clipped[0]*full,end=clipped[1]*full,step=3.5,c0=color(palettes[line.status]||palettes.unknown),c=line.highlighted?c0.map((n,i)=>i===3?1:Math.min(1,n*.65+.35)):c0;
      // Distinct silhouettes preserve status color while distinguishing levels.
      const style=line.level==='galaxy'?{dash:12,gap:8,half:1.4}:line.level==='planet'?{dash:6,gap:4,half:.8}:{dash:10,gap:6,half:1.1};
      const period=style.dash+style.gap;
      const interpolate=(p,q,t)=>p+(q-p)*t;
      // Screen-space interpolation uses homogeneous w to recover the matching
      // world-space sample for depth/planet occlusion checks.
      for(let base=Math.floor(start/period)*period;base<end;base+=period){const d0=Math.max(base,start),d1=Math.min(base+style.dash,end);if(d0>=d1)continue;const parts=Math.ceil((d1-d0)/step);for(let k=0;k<parts;k++){const s0=(d0+(d1-d0)*k/parts)/full,s1=(d0+(d1-d0)*(k+1)/parts)/full,mid=(s0+s1)/2;
        const denom=(1-mid)*b[3]+mid*a[3],t=denom?mid*a[3]/denom:0;
        const world=source.map((v,i)=>interpolate(v,target[i],t));
        const z0=interpolate(a[2],b[2],s0),z1=interpolate(a[2],b[2],s1);
        if(z0>=-1.000001&&z0<=1.000001&&z1>=-1.000001&&z1<=1.000001&&!isOccluded(eye,world,scene.occluder)){
          const x0=interpolate(sx,tx,s0),y0=interpolate(sy,ty,s0),x1=interpolate(sx,tx,s1),y1=interpolate(sy,ty,s1),length=Math.hypot(x1-x0,y1-y0);
          if(length>.001){const half=style.half+(line.highlighted?.9:0),ox=-(y1-y0)/length*half,oy=(x1-x0)/length*half;
            const vertex=(x,y,z)=>[(x/rect.width)*2-1,1-(y/rect.height)*2,z,...c];
            const aa=vertex(x0+ox,y0+oy,z0),bb=vertex(x0-ox,y0-oy,z0),cc=vertex(x1+ox,y1+oy,z1),dd=vertex(x1-ox,y1-oy,z1);
            out.push(...aa,...bb,...cc,...bb,...dd,...cc);lineSegments.push({id:line.id,x1:x0,y1:y0,x2:x1,y2:y1});}
        }
      }}
    }
    return out;
  }
  function hit(x,y){let best=null,bestD=Infinity;for(const p of projected){const d=Math.hypot(x-p.x,y-p.y);if(d<=p.r&&d<bestD){best=p.id;bestD=d;}}return best;}
  function updateHover(){if(hoverPoint&&!down){const id=hit(hoverPoint.x,hoverPoint.y);setHover(id);setLineHover(id===null?lineHit(hoverPoint.x,hoverPoint.y):null);}}
  function render(time){
    if(disposed||gl.isContextLost())return;
    try {
    if(cameraTarget){const dt=.14; yaw+=(cameraTarget.yaw-yaw)*dt;pitch+=(cameraTarget.pitch-pitch)*dt;distance+=(cameraTarget.distance-distance)*dt;if(Math.abs(cameraTarget.yaw-yaw)+Math.abs(cameraTarget.pitch-pitch)+Math.abs(cameraTarget.distance-distance)<.002){yaw=cameraTarget.yaw;pitch=cameraTarget.pitch;distance=cameraTarget.distance;cameraTarget=null;}}
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2), width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    gl.viewport(0,0,width,height);if(scene.type==='surface')gl.clearColor(.39,.64,.79,1);else if(scene.type==='unavailable')gl.clearColor(.10,.12,.13,1);else gl.clearColor(.025,.04,.075,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const eye=[distance*Math.cos(pitch)*Math.sin(yaw),distance*Math.sin(pitch),distance*Math.cos(pitch)*Math.cos(yaw)];
    const spin=0, rotation=rotateY(spin), vp=multiply(perspective(width/height),view(eye)), sceneVp=multiply(vp,rotation);
    const localEye=[Math.cos(spin)*eye[0]-Math.sin(spin)*eye[2],eye[1],Math.sin(spin)*eye[0]+Math.cos(spin)*eye[2]];
    const data=[];projected=[];
    // Stars are decorative, never archive objects or selection targets.
    if(scene.type==='universe'||scene.type==='galaxy'||scene.type==='planet'){let seed=4171;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const n=density==='high'?900:240;
      for(let i=0;i<n;i++){const x=rnd()*2-1,y=rnd()*2-1,a=.18+rnd()*.35;data.push(x,y,.99,.55,.68,.9,a,(1+rnd()*1.6)*dpr);}}
    gl.useProgram(pointProgram);gl.bindVertexArray(pointVao);gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.drawArrays(gl.POINTS,0,data.length/8);gl.disable(gl.BLEND);
    gl.useProgram(meshProgram);gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram,'vp'),false,vp);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    const drawMesh=m=>{gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram,'model'),false,multiply(rotation,m.model));gl.uniform4fv(gl.getUniformLocation(meshProgram,'color'),m.color);gl.bindVertexArray(m.vao);if(m.indexType)gl.drawElements(gl.TRIANGLES,m.count,m.indexType,0);else gl.drawArrays(gl.TRIANGLES,0,m.count);};
    for(const m of gpuMeshes)if(m.color[3]>=1)drawMesh(m);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    for(const m of gpuMeshes)if(m.color[3]<1)drawMesh(m);
    gl.depthMask(true);gl.disable(gl.BLEND);
    if(gpuSprites.length){gl.useProgram(spriteProgram);gl.uniformMatrix4fv(gl.getUniformLocation(spriteProgram,'vp'),false,sceneVp);gl.uniform1f(gl.getUniformLocation(spriteProgram,'pixelRatio'),dpr);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.depthMask(false);
      for(const p of gpuSprites){gl.bindVertexArray(p.vao);gl.drawArrays(gl.POINTS,0,p.count);}gl.depthMask(true);gl.disable(gl.BLEND);}
    const lineData=makeLines(sceneVp,localEye,rect);
    if(lineData.length){gl.useProgram(lineProgram);gl.bindVertexArray(lineVao);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(lineData),gl.DYNAMIC_DRAW);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,lineData.length/7);gl.depthMask(true);gl.disable(gl.BLEND);}
    const markers=[];
    for(const obj of scene.objects){const p=[obj.x,obj.y,obj.z];if(isOccluded(localEye,p,scene.occluder))continue;const v=project(sceneVp,p);if(!v||v[2]<-1||v[2]>1||Math.abs(v[0])>1||Math.abs(v[1])>1)continue;
      const size=Math.max(10,Math.min(40,Number(obj.size)||20)),c=color(obj.color);markers.push(v[0],v[1],v[2],...c,size*dpr);projected.push({id:obj.id,x:(v[0]+1)*rect.width/2,y:(1-v[1])*rect.height/2,r:Math.max(size/2,12)});}
    gl.useProgram(pointProgram);gl.bindVertexArray(pointVao);gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(markers),gl.DYNAMIC_DRAW);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.drawArrays(gl.POINTS,0,markers.length/8);gl.disable(gl.BLEND);gl.bindVertexArray(null);
    onLabels(projected);updateHover();frames++;if(time-lastFps>=1000){onStatus({fps:Math.round(frames*1000/(time-lastFps)),vertices:data.length/8+markers.length/8+lineData.length/7+gpuMeshes.reduce((n,m)=>n+m.count,0)+gpuSprites.reduce((n,p)=>n+p.count,0),drawCalls:2+(lineData.length?1:0)+gpuMeshes.length+gpuSprites.length,density});frames=0;lastFps=time;}
    if(!disposed)frame=requestAnimationFrame(render);
    } catch(e) { onLabels([]);onStatus({error:`그래픽 처리 중 오류: ${e.message}. 목록으로 계속 탐색할 수 있습니다.`}); }
  }
  const pointerDown=e=>{cameraTarget=null;hoverPoint=null;setHover(null);setLineHover(null);down={x:e.clientX,y:e.clientY,yaw,pitch,moved:false};canvas.setPointerCapture(e.pointerId);};
  const pointerMove=e=>{if(!down){if(e.pointerType==='touch')return;const rect=canvas.getBoundingClientRect();hoverPoint={x:e.clientX-rect.left,y:e.clientY-rect.top};updateHover();return;}const dx=e.clientX-down.x,dy=e.clientY-down.y;if(Math.hypot(dx,dy)>4)down.moved=true;yaw=down.yaw-dx*.008;pitch=Math.max(-1.45,Math.min(1.45,down.pitch+dy*.008));};
  const pointerUp=e=>{if(!down)return;const wasClick=!down.moved;down=null;if(wasClick){const rect=canvas.getBoundingClientRect(),id=hit(e.clientX-rect.left,e.clientY-rect.top);if(id!==null)onSelect(id);else{const lineId=lineHit(e.clientX-rect.left,e.clientY-rect.top);if(lineId!==null)onLineSelect(lineId);}}};
  const pointerCancel=()=>{down=null;hoverPoint=null;setHover(null);setLineHover(null);};
  const pointerLeave=()=>{hoverPoint=null;setHover(null);setLineHover(null);};
  function zoomBy(factor){if(!Number.isFinite(factor)||factor<=0)return false;cameraTarget=null;distance=Math.max(scene.type==='planet'?4.2:7,Math.min(60,distance*factor));return true;}
  const wheel=e=>{e.preventDefault();zoomBy(Math.exp(e.deltaY*.001));};
  const lost=e=>{e.preventDefault();hoverPoint=null;setHover(null);setLineHover(null);onLabels([]);onStatus({error:'그래픽 연결이 중단되었습니다. 목록으로 계속 탐색할 수 있습니다.'});};
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('pointerleave',pointerLeave);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('webglcontextlost',lost);
  frame=requestAnimationFrame(render);
  return {
    setScene(next){
      const value=Array.isArray(next)?{type:'universe',objects:next,meshes:[]}:next;
      const fresh=[],freshSprites=[];try{for(const m of value.meshes||[])fresh.push(upload(m));for(const p of value.pointSprites||[])freshSprites.push(uploadSprites(p));}catch(e){freeMeshes(fresh);freeMeshes(freshSprites);throw e;}
      freeMeshes();freeMeshes(gpuSprites);gpuMeshes=fresh;gpuSprites=freshSprites;
      scene={...value,lines:validateLines(value.lines),objects:(value.objects||[]).filter(o=>[o.x,o.y,o.z].every(Number.isFinite))};cameraTarget=null;focusOrigin=null;initialView={yaw:-.45,pitch:value.type==='surface'?.6:value.type==='galaxy'?.8:.25,distance:defaultDistance(value.type)};
      if(value.type==='planet'){const firstCity=scene.objects.find(o=>o.type==='city');if(firstCity){const c=value.occluder?.center||[0,0,0],x=firstCity.x-c[0],y=firstCity.y-c[1],z=firstCity.z-c[2],r=Math.hypot(x,y,z);if(r){initialView.yaw=Math.atan2(x,z);initialView.pitch=Math.max(-1.45,Math.min(1.45,Math.asin(Math.max(-1,Math.min(1,y/r)))));}}}
      ({yaw,pitch,distance}=initialView);projected=[];lineSegments=[];hoverPoint=null;setHover(null);setLineHover(null);onLabels([]);
    },
    setDensity(next){density=next==='high'?'high':'standard';},
    setLines(lines){scene.lines=validateLines(lines);lineSegments=[];setLineHover(null);},
    setLineHighlights(ids){const selected=new Set(Array.isArray(ids)?ids:[]);scene.lines=scene.lines.map(line=>({...line,highlighted:selected.has(line.id)}));},
    zoomBy,
    focusObject(id){
      if(scene.type!=='planet')return false;
      const obj=scene.objects.find(o=>o.id===id);if(!obj)return false;
      const c=scene.occluder?.center||[0,0,0],p=[obj.x-c[0],obj.y-c[1],obj.z-c[2]],r=Math.hypot(...p);if(!r)return false;
      if(!focusOrigin)focusOrigin={yaw,pitch,distance};
      let targetYaw=Math.atan2(p[0],p[2]);targetYaw=yaw+Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
      cameraTarget={yaw:targetYaw,pitch:Math.max(-1.45,Math.min(1.45,Math.asin(Math.max(-1,Math.min(1,p[1]/r))))),distance:Math.max((scene.occluder?.radius||2.7)*2.25,4.2)};
      return true;
    },
    clearFocus(){if(!focusOrigin)return;const y=yaw+Math.atan2(Math.sin(focusOrigin.yaw-yaw),Math.cos(focusOrigin.yaw-yaw));cameraTarget={...focusOrigin,yaw:y};focusOrigin=null;},
    getViewState(){return {type:scene.type,yaw,pitch,distance,focusOrigin:focusOrigin?{...focusOrigin}:null,cameraTarget:cameraTarget?{...cameraTarget}:null};},
    setViewState(state){
      const valid=v=>v&&[v.yaw,v.pitch,v.distance].every(Number.isFinite)&&v.pitch>=-1.45&&v.pitch<=1.45&&v.distance>=4.2&&v.distance<=60;
      if(!state||state.type!==scene.type||!valid(state)||(state.focusOrigin&&!valid(state.focusOrigin))||(state.cameraTarget&&!valid(state.cameraTarget)))return false;
      yaw=state.yaw;pitch=state.pitch;distance=state.distance;focusOrigin=state.focusOrigin?{...state.focusOrigin}:null;cameraTarget=state.cameraTarget?{...state.cameraTarget}:null;return true;
    },
    resetView(){cameraTarget=null;focusOrigin=null;({yaw,pitch,distance}=initialView);},
    dispose(){if(disposed)return;disposed=true;hoverPoint=null;setHover(null);setLineHover(null);cancelAnimationFrame(frame);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('pointerleave',pointerLeave);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('webglcontextlost',lost);freeMeshes();freeMeshes(gpuSprites);gpuSprites=[];gl.deleteBuffer(lineBuffer);gl.deleteVertexArray(lineVao);gl.deleteProgram(lineProgram);gl.deleteBuffer(pointBuffer);gl.deleteVertexArray(pointVao);gl.deleteProgram(pointProgram);gl.deleteProgram(spriteProgram);gl.deleteProgram(meshProgram);}
  };
}
