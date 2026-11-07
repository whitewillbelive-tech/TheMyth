// Illustrative, deterministic *demo* galaxies, not real observations.
// Coordinates and size are local scene units; point sizes are CSS pixels.
export function galaxySprites(shape = 'disk', center = [0, 0, 0], scale = 1, density = 'standard') {
  const count = density === 'high' ? 4200 : 2200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  let seed = shape === 'elliptical' ? 391473 : shape === 'irregular' ? 834927 : 191827;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Approximately normal: bounded to avoid isolated outliers dominating view.
  const normal = () => (random() + random() + random() + random() - 2) * 1.7;
  const origin = Array.isArray(center) && center.length === 3 && center.every(Number.isFinite) ? center : [0,0,0];
  const factor = Number.isFinite(scale) ? scale : 1;
  const put = (i, x, y, z, color, size) => {
    positions.set([origin[0]+x*factor,origin[1]+y*factor,origin[2]+z*factor],i*3);
    colors.set(color,i*4);
    sizes[i]=size;
  };
  for (let i=0;i<count;i++) {
    const u=random();
    if(shape==='elliptical') {
      const angle=random()*Math.PI*2, radius=Math.min(1.5,Math.abs(normal())*.47), v=random()*2-1, side=Math.sqrt(1-v*v);
      const glow=radius<.34;
      put(i,Math.cos(angle)*side*radius*1.45,v*radius*.75,Math.sin(angle)*side*radius,
        glow?[1,.91,.74,.60+random()*.35]:[.88,.80,.69,.22+random()*.43],glow?1.7+random()*2.2:.7+random()*1.8);
    } else if(shape==='irregular') {
      // Several distinct cloud centers create an asymmetric, clumpy silhouette.
      const clusters=[[-.78,-.06,.1],[-.14,.06,-.28],[.56,.20,.27],[.95,-.12,-.27],[.15,-.24,.65]], c=clusters[Math.floor(random()*clusters.length)];
      const hue=random(), color=hue<.18?[.98,.56,.72,.30+random()*.45]:hue<.56?[.50,.72,1,.32+random()*.52]:[.94,.90,.82,.3+random()*.5];
      put(i,c[0]+normal()*.25,c[1]+normal()*.15,c[2]+normal()*.25,color,.8+random()*2.5);
    } else {
      if(u<.22) {
        // Dense warm nucleus.
        put(i,normal()*.14,normal()*.045,normal()*.14,[1,.85+random()*.13,.66+random()*.30,.5+random()*.48],1.2+random()*2.8);
      } else {
        const radius=.22+Math.sqrt(random())*1.6, arm=i%3, angle=arm*Math.PI*2/3+radius*2.35+normal()*.18;
        const spread=.055+radius*.085, x=Math.cos(angle)*radius+normal()*spread, z=Math.sin(angle)*radius+normal()*spread;
        const shade=random();
        // Cooler arms with occasional pink nebulae and subdued dust lanes.
        const color=shade<.09?[.95,.48,.70,.32+random()*.40]:shade<.23?[.35,.39,.51,.12+random()*.20]:[.56+random()*.35,.72+random()*.22,1,.25+random()*.55];
        put(i,x,normal()*.045,z,color,.8+random()*2.5);
      }
    }
  }
  return {positions,colors,sizes};
}
