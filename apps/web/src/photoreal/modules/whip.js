/*
 * whip.js — Bid Wit Me effect module (motion-studio family; the shared core inlined like its
 * siblings, with a hand-authored build — the Motion Director sources are not in the repo).
 * The Whip-Crack: the Little Joker's throw action (owner-approved 2026-11-06). ONE crack line
 * whips across the table in a fast single stroke, with a small shiver through the felt — the
 * deliberate opposite of the Big Joker's quake (Big = weight and sprawl; Little = speed and
 * precision). No degree scale: a single treatment.
 * API (identical to quake.js):
 *   const fx = createFx(canvas, { seed, drawScene?(ctx,W,H,t), lowPower?, x?, y? });
 *   fx.duration (s); fx.render(t) draws frame t (deterministic: same seed+t => same pixels);
 *   const stop = fx.play(onEnd)  // realtime via requestAnimationFrame
 * Without drawScene the canvas is a transparent overlay and refraction is skipped.
 * Sound sync: the host fires the glassCrack snap at WHIP_SNAP_T, keyed to the stroke below
 * (t0 ≈ .06–.10, the line down in ~.34 s) — change them together.
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
  const env={_grains:grains,trx,tryy,lowPower,ctx,W,H,S,cx,cy,seed,power:opts.power??2,Q,snap,sctx,R:rngOf(seed),
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

function build(env){const{ctx,W,H,S,cx,cy,Q}=env,R=env.R,D=1.7,N=v=>Math.round(v*Q);
  const DU=env.spritesSmoke([140,124,104],6);
  /* the shiver: a fast, small tremor through the felt as the line lands */
  const amp=t=>sstep(.04,.14,t)*(1-sstep(.45,.95,t));
  /* ONE crack: a single stroke whipping across the felt, starting just
   * inside one rim of the table ellipse and running through the centre
   * to the far side (direction varies with the seed). It holds its
   * heading — weak wander, strong pull, no branches — and lands fast:
   * point times are compressed so the whole line is down in ~.34 s. */
  const cracks=[];const rr=rngOf(env.seed+11);
  function grow(x,y,ang,len,w,t0){const pts=[[x,y,t0]];let tt=t0;const a0=ang;for(let i=0;i<len;i++){ang+=(rr()-.5)*.55+(a0-ang)*.45;const st=S*.02*(.6+rr()*.7);w*=.995;x+=Math.cos(ang)*st;y+=Math.sin(ang)*st*.42;tt+=(.0016+rr()*.0014)*(1+i*.004);pts.push([x,y,tt]);}cracks.push({pts,w});}
  const th=rr()*6.283;
  grow(cx-Math.cos(th)*env.trx*.9,cy-Math.sin(th)*env.tryy*.9,th,118,S*.006,.06+rr()*.04);
  const tips=[];cracks.forEach(c=>c.pts.forEach((p,i)=>{if(i%9===4)tips.push({x:p[0],y:p[1],t:p[2],v:rr()});}));
  const chips=Array.from({length:N(14)},()=>({i:(rr()*tips.length)|0,a:rr()*6.283,sp:.2+rr()*.5,v:rr()}));
  return{duration:D,
  shake(t){const A=amp(t);return env.shake(t,S*.0035*A,46).map((v,i)=>v+Math.sin(t*(i?83:97))*S*.0012*A);},
  draw(t){const fade=1-sstep(D-.5,D,t);
   /* the crack: shadowed gash + 1px lit lip, revealed progressively —
    * the widening is near-instant: the line lands, it does not sprawl */
   ctx.save();ctx.beginPath();ctx.ellipse(cx,cy,env.trx*.97,env.tryy*.97,0,0,7);ctx.clip();
   for(const c of cracks){const op=sstep(0,.25,t-c.pts[0][2]);ctx.lineCap='round';ctx.lineJoin='round';
     for(const [col,lw,ox,oy,al] of [['rgba(0,0,0,1)',c.w*(1.4+1.6*op),c.w*.3,c.w*.5,.45],['rgba(12,7,4,1)',c.w*(.5+.9*op),0,0,1],['rgba(2,1,0,1)',c.w*(.2+.4*op),0,c.w*.15,1],['rgba(140,185,140,1)',Math.max(1,c.w*.3),-c.w*(.4+.5*op),-c.w*(.5+.4*op),.4]]){
       ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.globalAlpha=al*fade;ctx.beginPath();let on=false;
       for(let i=1;i<c.pts.length;i++){const p=c.pts[i];if(p[2]>t)break;const q=c.pts[i-1];ctx.moveTo(q[0]+ox,q[1]+oy);ctx.lineTo(p[0]+ox,p[1]+oy);on=true;}if(on)ctx.stroke();}}
   /* a breath of dust where the front passes, and a few chips */
   for(const p of tips){const a=t-p.t;if(a<0||a>0.9)continue;env.draw(DU[(p.v*6)|0],p.x,p.y-S*.02*a,S*(.015+.03*a),.22*(1-a/0.9)*fade);}
   for(const c of chips){const p=tips[c.i];if(!p)continue;const a=t-p.t;if(a<0||a>.6)continue;const x=p.x+Math.cos(c.a)*c.sp*S*a*.4,y=p.y-c.sp*S*a+S*1.8*a*a;ctx.fillStyle='rgb(30,60,40)';ctx.globalAlpha=fade;ctx.fillRect(x,y,S*.003,S*.003);}
   ctx.restore();
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
