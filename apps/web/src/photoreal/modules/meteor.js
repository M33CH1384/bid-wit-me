/*
 * meteor.js — Bid Wit Me effect prototype (motion-studio, code-made, no assets, no deps).
 * Meteor: incoming fire head with cooling smoke trail, impact flash, crater glow, shockwave, debris, dust.
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

function build(env){const{ctx,W,H,S,cx,cy,Q}=env,R=env.R,D=4.4,TI=1.3,N=v=>Math.round(v*Q);
  const F=env.spritesFire(3),SM=env.spritesSmoke([96,90,88],6),DU=env.spritesSmoke([120,100,80],6);
  const x0=cx+W*.7,y0=-H*.35;const path=k=>[lerp(x0,cx,k),lerp(y0,cy,k*k*.25+k*.75)];
  const trail=Array.from({length:N(120)},(_,i)=>({k:i/N(120),v:R(),ox:R()-.5,oy:R()-.5}));
  const deb=Array.from({length:N(130)},()=>{const sp=.3+R()*1.1;return{a:R()*6.283,sp,up:sp*(.8+R()*.5),v:R()}});
  const dust=Array.from({length:N(150)},()=>({a:R()*6.283,v:R()}));
  const emb=Array.from({length:N(40)},()=>({a:R()*6.283,r:R(),v:R()}));
  return{duration:D,
  shake(t){const a=t-TI;return a<0?env.shake(t,S*.002*t,20):env.shake(t,S*.025*Math.exp(-a*2.6),22);},
  draw(t){const fade=1-sstep(D-.7,D,t),k=clamp(t/TI),a=t-TI;
   env.fill('rgb(8,8,14)',.45*fade);
   if(a>0){const sr=S*1.4*Math.pow(a,.65);env.refract(cx,cy,sr,S*.02,.42,.045*Math.exp(-a*1.5));}
   /* crater: dark scorched bowl + cooling molten rim */
   if(a>0){const g=ctx.createRadialGradient(cx,cy,0,cx,cy,S*.12);g.addColorStop(0,'rgba(8,4,2,.95)');g.addColorStop(.55,'rgba(25,12,6,.7)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.save();ctx.translate(cx,cy);ctx.scale(1,.42);ctx.translate(-cx,-cy);ctx.globalAlpha=sstep(0,.08,a)*fade;ctx.fillStyle=g;ctx.fillRect(cx-S*.13,cy-S*.13,S*.26,S*.26);ctx.restore();
     for(const p of emb){const r=S*.06*(.7+.4*p.r),x=cx+Math.cos(p.a)*r,y=cy+Math.sin(p.a)*r*.42;env.draw(env.fireAt(F,.8*Math.exp(-a*.8)*(.6+.4*p.v))[(p.v*3)|0],x,y,S*.03,Math.exp(-a*.7)*fade,'lighter');}}
   /* smoke trail: puffs left behind at path(k_i), cooling and drifting */
   for(const p of trail){if(p.k>k)continue;const age=t-p.k*TI;const[x,y]=path(p.k);const sz=S*(.025+.05*age*(.6+p.v));const dx=p.ox*S*.03*age,dy=p.oy*S*.03*age-S*.01*age;
     env.draw(SM[(p.v*6)|0],x+dx,y+dy,sz*1.6,.6*Math.exp(-age*.5)*fade);
     env.draw(env.fireAt(F,clamp(1-age*2.2))[(p.v*3)|0],x+dx,y+dy,sz*1.3,clamp(1-age*2.5)*fade,'lighter');}
   /* head + plasma glow lighting the table */
   if(a<0){const[x,y]=path(k),[px,py]=path(Math.max(0,k-.04));ctx.globalCompositeOperation='lighter';ctx.strokeStyle='rgb(255,230,180)';ctx.lineCap='round';ctx.globalAlpha=.8;ctx.lineWidth=S*.012;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();ctx.globalCompositeOperation='source-over';
     env.draw(env.G.white,x,y,S*.1,1,'lighter');env.draw(env.G.warm,x,y,S*.5,.6,'lighter');env.draw(env.G.warm,cx,cy,S*1.2,.4*k*k,'lighter');}
   else{/* impact */
     const front=S*1.1*Math.pow(a,.55);for(const p of dust){const r=front*(.55+.45*p.v),[x,y0,kk]=env.onTable(Math.cos(p.a)*r,Math.sin(p.a)*r*.42);const y=y0-S*.03*a*p.v;env.draw(DU[(p.v*6)|0],x,y,S*(.04+.05*a),(1-sstep(.7,1.05,kk))*.38*sstep(0,.15,a)*(1-sstep(1.2,3,a))*fade);}
     ctx.lineWidth=Math.max(1,S*.003);for(const p of deb){const vx=Math.cos(p.a)*p.sp*S*.8,vy=-p.up*S,g=S*2,x=cx+vx*a,y=cy+vy*a+g*a*a;if(a>1.8||y>cy+S*.15)continue;const hot=p.v>.45;
       ctx.globalCompositeOperation=hot?'lighter':'source-over';ctx.strokeStyle=hot?'rgb(255,170,70)':'rgb(28,22,18)';ctx.globalAlpha=(1-a/1.6)*fade;ctx.beginPath();ctx.moveTo(x-vx*.03,y-(vy+2*g*a)*.03);ctx.lineTo(x,y);ctx.stroke();}
     ctx.globalCompositeOperation='source-over';
     const fb=Math.exp(-a*2.2);for(let i=0;i<8;i++){const ang=i*.8+a;env.draw(env.fireAt(F,fb)[i%3],cx+Math.cos(ang)*S*.05*a*3,cy-S*.06*a*2-Math.abs(Math.sin(ang))*S*.04,S*(.1+.2*a),fb*fade,'lighter');}
     env.draw(env.G.warm,cx,cy,S*1.4,.8*Math.exp(-a*1.3)*fade,'lighter');env.fill('rgb(255,236,210)',.5*Math.exp(-a*14),'lighter');
     ctx.save();ctx.translate(cx,cy);ctx.scale(1,.42);env.draw(env.G.warm,0,0,S*.7,.55*Math.exp(-a*.9)*fade,'lighter');env.draw(env.G.white,0,0,S*.12,.6*Math.exp(-a*2.5)*fade,'lighter');ctx.restore();}
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
