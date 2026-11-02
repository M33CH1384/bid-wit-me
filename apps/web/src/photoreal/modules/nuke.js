/*
 * nuke.js — Bid Wit Me effect prototype (motion-studio, code-made, no assets, no deps).
 * Nuke: flash, fireball, rolling mushroom cap, Wilson ring, shockwave refraction, dust skirt, flung cards, embers.
 * API:
 *   const fx = createFx(canvas, { seed, drawScene?(ctx,W,H,t), lowPower?, x?, y? });
 *   fx.duration (s); fx.render(t) draws frame t (deterministic: same seed+t => same pixels);
 *   const stop = fx.play(onEnd)  // realtime via requestAnimationFrame
 * Pass drawScene to get refraction/heat shimmer over the scene; without it the canvas is a transparent
 * overlay (put it above the table canvas) and refraction is skipped. lowPower: fewer particles (iPhone).
 */
export function createFx(canvas, opts = {}) {
/* ---- shared core (inlined into every module by build.sh) ---- */
const clamp=(v,a=0,b=1)=>v<a?a:v>b?b:v, lerp=(a,b,k)=>a+(b-a)*k, sstep=(a,b,v)=>{v=clamp((v-a)/(b-a));return v*v*(3-2*v)};
const easeOut=k=>1-Math.pow(1-clamp(k),3);
function hash(i,j,s){let h=Math.imul(i|0,374761393)+Math.imul(j|0,668265263)+Math.imul(s|0,1442695041);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function rngOf(s){s=s|0;return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^(s>>>15),1|s);t=t+Math.imul(t^(t>>>7),61|t)^t;return((t^(t>>>14))>>>0)/4294967296;};}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash(xi,yi,s),b=hash(xi+1,yi,s),c=hash(xi,yi+1,s),d=hash(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function fbm(x,y,s,o=5){let f=0,a=.5,n=0;for(let i=0;i<o;i++){f+=a*vnoise(x,y,s+i*17);n+=a;x=x*2.03+1.7;y=y*2.03-.9;a*=.5;}return f/n;}
/* curl-ish turbulence: gradient of fbm rotated 90deg (used for smoke drift) */
function curl(x,y,s){const e=.05,n1=fbm(x,y+e,s,3),n2=fbm(x,y-e,s,3),n3=fbm(x+e,y,s,3),n4=fbm(x-e,y,s,3);return[(n1-n2)/(2*e),-(n3-n4)/(2*e)];}
function mkCanvas(w,h){const c=typeof document!=='undefined'?document.createElement('canvas'):new OffscreenCanvas(w,h);c.width=w;c.height=h;return c;}
/* blackbody-ish ramp, T 0..1 */
const RAMP=[[0,[40,12,6]],[.22,[150,32,8]],[.42,[235,95,20]],[.62,[255,170,60]],[.8,[255,225,150]],[1,[255,252,240]]];
function ramp(T){T=clamp(T);for(let i=1;i<RAMP.length;i++)if(T<=RAMP[i][0]){const[a,ca]=RAMP[i-1],[b,cb]=RAMP[i],k=(T-a)/(b-a);return[ca[0]+(cb[0]-ca[0])*k,ca[1]+(cb[1]-ca[1])*k,ca[2]+(cb[2]-ca[2])*k];}return RAMP[5][1];}
/* billowy, noise-eroded, self-shadowed puff. kind: 'smoke' (col tint, normal blend) | 'fire' (T temp, additive) */
function puff(size,seed,kind,arg,rough=.85){const c=mkCanvas(size,size),x=c.getContext('2d'),id=x.createImageData(size,size),d=id.data;
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){const nx=(i/size-.5)*2,ny=(j/size-.5)*2,r=Math.hypot(nx,ny);
    const n=fbm(nx*2.3+seed*7.3,ny*2.3+seed*3.1,seed,5),n2=fbm(nx*2.3+seed*7.3-.12,ny*2.3+seed*3.1-.12,seed,5);
    const edge=r+(n-.5)*rough;let a=clamp((.9-edge)/.38);a=a*a*(3-2*a);const p=(j*size+i)*4;
    if(kind==='fire'){const T=clamp(arg*(.55+.65*a)*(.75+.5*n));const c3=ramp(T);d[p]=c3[0];d[p+1]=c3[1];d[p+2]=c3[2];d[p+3]=255*a*clamp(.35+T);}
    else{const lit=clamp(.62+(n2-n)*5.5+(-nx-ny)*.12+(n-.5)*.5,.2,1.25);d[p]=arg[0]*lit;d[p+1]=arg[1]*lit;d[p+2]=arg[2]*lit;d[p+3]=255*a*(.55+.45*n);}}
  x.putImageData(id,0,0);return c;}
function glow(size,col,fall=2.2){const c=mkCanvas(size,size),x=c.getContext('2d'),g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  for(let k=0;k<=8;k++){const v=k/8,a=Math.pow(1-v,fall);g.addColorStop(v,`rgba(${col[0]},${col[1]},${col[2]},${a})`);}x.fillStyle=g;x.fillRect(0,0,size,size);return c;}
function makeEnv(canvas,opts,eff){
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,S=Math.min(W,H),seed=opts.seed??7;
  const cx=opts.x??W/2,cy=opts.y??H*.56;const lowPower=!!opts.lowPower;const Q=lowPower?.45:1;const SP=lowPower?64:96;
  /* table ellipse (canvas px) so ground effects stay on the felt; matches the harness table */
  const trx=opts.tableRx??Math.min(W*.46,S*.95),tryy=opts.tableRy??trx*.42;
  const snap=mkCanvas(W,H),sctx=snap.getContext('2d');
  const grains=[0,1,2].map(k=>{const g=mkCanvas(160,160),gx=g.getContext('2d'),id=gx.createImageData(160,160),r=rngOf(seed+k*99);for(let p=0;p<id.data.length;p+=4){const v=r()*255;id.data[p]=id.data[p+1]=id.data[p+2]=v;id.data[p+3]=255;}gx.putImageData(id,0,0);return g;});
  const env={_grains:grains,trx,tryy,lowPower,ctx,W,H,S,cx,cy,seed,Q,snap,sctx,R:rngOf(seed),
    G:{white:glow(128,[255,250,240]),warm:glow(128,[255,150,60]),blue:glow(128,[170,190,255]),gold:glow(128,[255,210,120])},
    spritesSmoke(col,n=6,size=SP,rough=.9){size=Math.min(size,SP);return Array.from({length:n},(_,k)=>puff(size,seed*31+k*13+col[0],'smoke',col,rough));},
    spritesFire(n=3,size=SP){return[.25,.5,.75,1].map(T=>Array.from({length:n},(_,k)=>puff(size,seed*17+k*7+T*50|0,'fire',T,1)));},
    fireAt(F,T){return F[clamp(Math.floor(clamp(T)*4),0,3)];},
    draw(img,x,y,s,a,op){if(a<=.003||s<1)return;ctx.globalAlpha=Math.min(1,a);if(op)ctx.globalCompositeOperation=op;ctx.drawImage(img,x-s/2,y-s/2,s,s);if(op)ctx.globalCompositeOperation='source-over';},
    fill(col,a,op){if(a<=.003)return;ctx.globalAlpha=Math.min(1,a);ctx.globalCompositeOperation=op||'source-over';ctx.fillStyle=col;ctx.fillRect(-W,-H,W*3,H*3);ctx.globalCompositeOperation='source-over';},
    /* shockwave refraction: annulus of the scene snapshot magnified about the centre */
    refract(x,y,r,th,sq,str){if(!opts.drawScene||lowPower||r<2)return;ctx.save();ctx.beginPath();ctx.ellipse(x,y,r+th,(r+th)*sq,0,0,7);ctx.ellipse(x,y,Math.max(1,r-th),Math.max(1,r-th)*sq,0,0,7);ctx.clip('evenodd');ctx.globalAlpha=1;
      const k=1+str;ctx.drawImage(snap,x-x*k,y-y*k,W*k,H*k);ctx.restore();},
    /* heat shimmer: horizontal strips of the snapshot displaced by travelling sine */
    shimmer(x0,y0,w,h,amp,t){if(!opts.drawScene||lowPower||amp<.2)return;const st=Math.max(3,h/40|0);ctx.globalAlpha=1;for(let y=y0;y<y0+h;y+=st){const dx=Math.sin(y*.045+t*13)*amp*Math.sin(Math.PI*(y-y0)/h);
      const sx=clamp(x0,0,W-1),sy=clamp(y,0,H-1);ctx.drawImage(snap,sx,sy,Math.min(w,W-sx),Math.min(st,H-sy),sx+dx,sy,Math.min(w,W-sx),Math.min(st,H-sy));}},
    /* clamp a ground point (relative to cx,cy) into the table ellipse */
    onTable(dx,dy,m=.96){const k=Math.hypot(dx/(trx*m),dy/(tryy*m));return k>1?[cx+dx/k,cy+dy/k,k]:[cx+dx,cy+dy,k];},
    shake(t,amp,f=24){return[(fbm(t*f,1.3,seed,3)-.5)*2*amp,(fbm(4.1,t*f,seed+5,3)-.5)*2*amp];},
  };
  return env;}
function finish(env,t){const{ctx,W,H}=env;ctx.globalCompositeOperation='source-over';
  /* film grain */
  ctx.globalAlpha=.055;const gi=Math.floor(t*24)%3;ctx.fillStyle=ctx.createPattern(env._grains[gi],'repeat');ctx.save();ctx.translate((t*997)%160,(t*571)%160);ctx.fillRect(-160,-160,W+320,H+320);ctx.restore();
  ctx.globalAlpha=1;}

function build(env){const{ctx,W,H,S,cx,cy,Q}=env,R=env.R,D=4.8,T0=.28;
  const F=env.spritesFire(3),SM=env.spritesSmoke([92,84,80],8,96,1.05),SD=env.spritesSmoke([70,62,58],6),SC=env.spritesSmoke([235,235,238],4,96,1.1),DU=env.spritesSmoke([150,128,100],5);
  const N=v=>Math.round(v*Q);
  const ball=Array.from({length:N(70)},()=>({a:R()*6.283,r:Math.sqrt(R()),ph:R()*6.283,v:R(),sp:.6+R()}));
  const cap=Array.from({length:N(120)},()=>({a:R()*6.283,b:R()*6.283,v:R(),s:.7+R()*.6}));
  const stem=Array.from({length:N(36)},()=>({o:R(),x:(R()-.5),v:R()}));
  const ring=Array.from({length:N(40)},()=>({a:R()*6.283,v:R()}));
  const dust=Array.from({length:N(110)},()=>({a:R()*6.283,v:R(),d:.8+R()*.4}));
  const deb=Array.from({length:N(70)},()=>({a:R()*6.283,sp:.5+R()*1.4,up:.4+R()*1.2,card:R()<.18,rot:R()*6,v:R()}));
  const emb=Array.from({length:N(90)},()=>({x:R(),y:R(),v:R(),ph:R()*6}));
  const sq=.42; /* table perspective squash */
  return{duration:D,
  shake(t){const k=t<T0?0:Math.exp(-(t-T0)*2.0)*(1-sstep(D-.6,D,t));return env.shake(t,S*.022*k);},
  draw(t){const a=t-T0,fade=1-sstep(D-.9,D,t);
   const capY=cy-S*(.08+.34*easeOut(a/2.6)),capR=S*(.05+.17*easeOut(a/2.2)),cool=clamp(a/2.4);
   /* heat shimmer + shockwave refraction from the scene */
   if(a>0){const sr=S*1.7*Math.pow(a,.7);env.refract(cx,cy,sr,S*.025,sq,.05*Math.exp(-a*1.2));
     env.shimmer(cx-capR*1.6,capY-capR,capR*3.2,cy-capY+capR,S*.006*(1-cool)*fade,t);}
   /* scene darkens as the cloud blocks the light, then the fireball relights it */
   env.fill('rgb(8,6,10)',(a>0?.5*sstep(0,.8,a):0)*fade);
   const L=a<0?sstep(0,T0,t):Math.exp(-a*.9);/* fireball luminance */
   env.draw(env.G.warm,cx,(cy+capY)/2,S*(1.6+1.2*L),(.25+.6*L)*fade,'lighter');
   if(a<0){env.draw(env.G.white,cx,cy,S*.15*sstep(0,T0,t),1,'lighter');return;}
   /* dust skirt rolling outward along the felt */
   for(const p of dust){const r=S*(.15+1.05*Math.pow(a*p.d,.6))*(.9+.2*p.v);const[x,y0,k]=env.onTable(Math.cos(p.a)*r,Math.sin(p.a)*r*sq);const y=y0-S*.03*p.v;
     env.draw(DU[(p.v*5)|0],x,y,S*(.05+.07*a)*(.7+p.v),(1-sstep(.7,1.05,k))*.45*sstep(0,.25,a)*(1-sstep(1.2,3.2,a))*fade);}
   /* stem: rising column, back-lit, cooling */
   for(const p of stem){const h=(p.o+a*.35)%1,y=lerp(cy,capY+capR*.3,h),w=S*(.035+.03*h)*sstep(0,.6,a);const x=cx+p.x*w*1.6+Math.sin(h*9+a*2)*w*.25;
     env.draw(SD[(p.v*6)|0],x,y,w*2.6,.95*sstep(0,.5,a)*fade);env.draw(env.fireAt(F,.55*(1-cool)*(1-h))[(p.v*3)|0],x,y,w*2.2,.7*(1-cool)*fade,'lighter');}
   /* condensation (Wilson) ring around the stem */
   const cr=sstep(.7,1.2,a)*(1-sstep(1.8,3,a));if(cr>0)for(const p of ring){const r=capR*(1.3+.6*sstep(.7,2.4,a)),x=cx+Math.cos(p.a)*r,y=lerp(cy,capY,.45)+Math.sin(p.a)*r*.22;
     env.draw(SC[(p.v*4)|0],x,y,S*.07*(.7+p.v),.5*cr*(Math.sin(p.a)>0?1:.6)*fade);}
   /* cap: toroidal roll, sorted back to front */
   const list=cap.map(p=>{const roll=p.b+a*2.2,rr=capR*(1+.38*Math.cos(roll)),ang=p.a+a*.15;
     return{x:cx+Math.cos(ang)*rr,y:capY+Math.sin(ang)*rr*.34-Math.sin(roll)*capR*.42,z:Math.sin(ang)+Math.cos(roll)*.3,p,roll};}).sort((u,v)=>u.z-v.z);
   for(const q of list){const{p}=q,sz=capR*.85*p.s,front=.55+.45*clamp(q.z*.5+.5),T=(1-cool)*(.75+.25*Math.cos(q.roll))*(1-p.v*.35);
     env.draw(SD[(p.v*6)|0],q.x+sz*.12,q.y+sz*.18,sz*1.25,clamp(cool*1.4)*.7*fade);
     env.draw(SM[(p.v*8)|0],q.x,q.y,sz*1.2,clamp(cool*1.4)*fade*front);
     if(Math.sin(q.roll)>.3)env.draw(env.G.warm,q.x,q.y-sz*.3,sz*.5,.12*fade*cool,'lighter');
     env.draw(env.fireAt(F,T)[(p.v*3)|0],q.x,q.y,sz*(1.1+.4*(1-cool)),clamp(1.2-cool*1.15)*.7*fade,'lighter');
     /* under-light from the fire onto the smoke */
     if(cool>.3)env.draw(env.G.warm,q.x,q.y+sz*.25,sz*.9,.22*(1-cool*.7)*fade*(Math.cos(q.roll)>0?1:.4),'lighter');}
   /* early fireball core */
   const core=Math.exp(-a*1.6)*.8;for(const p of ball){const r=capR*.9*p.r,ang=p.a+a*p.sp*.8;env.draw(env.fireAt(F,core*(1-p.r*.4)+.15)[(p.v*3)|0],cx+Math.cos(ang)*r,capY+Math.sin(ang)*r*.8,capR*(.7+.5*p.v),core*fade,'lighter');}
   /* shock front: bright edge on felt */
   {const sr=S*1.7*Math.pow(a,.7),k=Math.exp(-a*1.8);ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=.5*k;ctx.strokeStyle='rgb(255,220,170)';ctx.lineWidth=S*.006;ctx.beginPath();ctx.ellipse(cx,cy,sr,sr*sq,0,0,7);ctx.stroke();ctx.restore();}
   /* debris + flung cards with motion blur */
   for(const p of deb){const tt=a,vx=Math.cos(p.a)*p.sp*S*.9,vy=-p.up*S*.9,g=S*1.6;const x=cx+vx*tt,y=cy+Math.sin(p.a)*S*.05+vy*tt+g*tt*tt;if(y>H*1.1||tt>2.6)continue;
     const dx=vx*.03,dy=(vy+2*g*tt)*.03;ctx.globalAlpha=fade*(1-sstep(1.6,2.6,tt));
     if(p.card){ctx.save();ctx.translate(x,y);ctx.rotate(p.rot+tt*9*p.v);ctx.scale(1,Math.cos(tt*12*p.v+p.rot));ctx.fillStyle='rgba(240,236,226,1)';ctx.fillRect(-S*.012,-S*.017,S*.024,S*.034);ctx.restore();}
     else{ctx.strokeStyle=p.v>.5?'rgb(255,170,80)':'rgb(30,24,20)';ctx.lineWidth=S*.004;ctx.beginPath();ctx.moveTo(x-dx,y-dy);ctx.lineTo(x,y);ctx.stroke();}}
   /* embers + ash drifting down */
   if(a>1.2)for(const p of emb){const k=clamp((a-1.2-p.v*.8)/2.2);if(k<=0)continue;const x=W*p.x+Math.sin(a*1.3+p.ph)*S*.03,y=H*(p.y*.6+k*.5)-H*.1;const fl=.5+.5*Math.sin(a*14+p.ph*5);
     env.draw(env.G.warm,x,y,S*.012*(1+fl),(1-k)*fade*.9,'lighter');}
   /* white-out flash, exposure falloff */
   const fl=Math.exp(-a*7.5);env.fill('rgb(255,236,205)',fl*.62,'lighter');env.fill('rgb(255,140,40)',.18*Math.exp(-a*1.2)*fade,'lighter');
  }};}

  const env = makeEnv(canvas, opts), e = build(env);
  function render(t) { const { ctx, W, H } = env; ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0,0,W,H);
    const [sx, sy] = e.shake ? e.shake(t) : [0, 0];
    if (opts.drawScene) { ctx.save(); ctx.translate(sx, sy); opts.drawScene(ctx, W, H, t); ctx.restore(); env.sctx.clearRect(0,0,W,H); env.sctx.drawImage(canvas, 0, 0); }
    ctx.save(); ctx.translate(sx, sy); e.draw(t); ctx.restore(); finish(env, t); }
  function play(onEnd) { let t0 = null, id = 0; const step = now => { if (t0 === null) t0 = now; const t = (now - t0) / 1000;
      if (t >= e.duration) { env.ctx.clearRect(0,0,env.W,env.H); onEnd && onEnd(); return; } render(t); id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step); return () => cancelAnimationFrame(id); }
  return { duration: e.duration, render, play };
}
