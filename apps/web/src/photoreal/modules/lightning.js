/*
 * lightning.js — Bid Wit Me effect prototype (motion-studio, code-made, no assets, no deps).
 * Lightning: stepped leader, branching return stroke with restrikes, scene flash, sparks, scorch + smoke.
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

function build(env){const{ctx,W,H,S,cx,cy,Q}=env,R=env.R,D=3.6;
  const SM=env.spritesSmoke([90,90,96],6);
  /* midpoint-displacement channel with seeded branches */
  function bolt(x0,y0,x1,y1,dev,depth,rr,out,w){if(depth===0){out.push([x0,y0,x1,y1,w]);return;}const mx=(x0+x1)/2+(rr()-.5)*dev,my=(y0+y1)/2+(rr()-.5)*dev*.3;
    bolt(x0,y0,mx,my,dev/2,depth-1,rr,out,w);bolt(mx,my,x1,y1,dev/2,depth-1,rr,out,w);
    if(depth>2&&rr()<.42*w){const ang=Math.atan2(y1-y0,x1-x0)+(rr()-.5)*1.6,len=Math.hypot(x1-x0,y1-y0)*(.7+rr());bolt(mx,my,mx+Math.cos(ang)*len,my+Math.sin(ang)*len,dev/2,depth-2,rr,out,w*.5);}}
  const sx=cx+(R()-.5)*W*.3,segs=[];bolt(sx,-H*.05,cx,cy,S*.75,9,rngOf(env.seed+3),segs,1);
  const sy0=-H*.05;segs.forEach(s=>s.p=(Math.max(s[1],s[3])-sy0)/(cy-sy0));
  const strikes=[[.55,1],[.64,.55],[.76,.9],[.97,.5],[1.32,.38]];
  const sparks=Array.from({length:Math.round(70*Q)},()=>({a:-Math.PI*R(),sp:.3+R()*1.2,v:R()}));
  const smoke=Array.from({length:Math.round(22*Q)},()=>({o:R(),x:R()-.5,v:R()}));
  const env1=t=>{let e=0;for(const[s,k]of strikes)if(t>=s)e+=k*Math.exp(-(t-s)*22)*(.7+.3*Math.sin((t-s)*180));return e;};
  return{duration:D,
  shake(t){return env.shake(t,S*.008*Math.exp(-Math.max(0,t-.55)*6)*(t>.55?1:0),30);},
  draw(t){const fade=1-sstep(D-.6,D,t),E=env1(t);
   env.fill('rgb(6,10,22)',.6*sstep(0,.4,t)*fade);
   /* scorch on the felt */
   if(t>.55){const g=ctx.createRadialGradient(cx,cy,0,cx,cy,S*.09);g.addColorStop(0,'rgba(10,6,4,.85)');g.addColorStop(.6,'rgba(20,12,6,.4)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.globalAlpha=sstep(.55,.65,t)*fade;ctx.fillStyle=g;ctx.save();ctx.translate(cx,cy);ctx.scale(1,.42);ctx.translate(-cx,-cy);ctx.fillRect(cx-S*.1,cy-S*.1,S*.2,S*.2);ctx.restore();
     env.draw(env.G.warm,cx,cy,S*.12,.9*Math.exp(-(t-.55)*1.5)*fade,'lighter');}
   /* stepped leader (faint, growing down), then full channel at each stroke */
   const lead=sstep(.2,.55,t);const vis=s=>t<.55?s.p<=lead&&s[4]>.2:true;
   const passes=[[S*.03,.05,'120,140,255'],[S*.012,.18,'170,185,255'],[S*.005,.55,'225,230,255'],[S*.0018,1,'255,255,255']];
   ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
   const I=t<.55?.25*lead:E+(t<1.6?.06*Math.exp(-(t-.55)*3):0);
   for(const[lw,al,col]of passes){ctx.strokeStyle=`rgb(${col})`;for(const s of segs){if(!vis(s))continue;ctx.globalAlpha=clamp(al*I*(.35+.65*s[4]));ctx.lineWidth=lw*1.6*(.3+.7*s[4]);ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();}}
   /* retinal afterimage / glowing channel decay */
   let AF=0;for(const[s,k]of strikes)if(t>=s)AF+=.3*k*Math.exp(-(t-s)*4);ctx.strokeStyle='rgb(170,120,255)';for(const s of segs){if(s[4]<.4)continue;ctx.globalAlpha=clamp(AF*s[4]*fade);ctx.lineWidth=S*.007*s[4];ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();}
   ctx.globalCompositeOperation='source-over';
   /* strobe: between strokes the eye adapts, scene drops darker */
   if(t>.55&&t<1.6)env.fill('rgb(2,3,8)',.25*clamp(1-E*6)*fade);
   env.draw(env.G.blue,cx,cy,S*.9,E*.9,'lighter');env.draw(env.G.blue,sx,-H*.05,S*1.6,E*.8,'lighter');env.draw(env.G.white,cx,cy,S*.18,E,'lighter');
   /* sparks: ballistic with blur */
   if(t>.55){const a=t-.55;ctx.lineWidth=Math.max(1,S*.002);for(const p of sparks){const vx=Math.cos(p.a)*p.sp*S,vy=Math.sin(p.a)*p.sp*S*.9,g=S*2.2,x=cx+vx*a,y=cy+vy*a+g*a*a,life=1-a/(0.3+p.v*.7);if(life<=0)continue;
     ctx.strokeStyle=`rgb(255,${200+55*life|0},${120+100*life|0})`;ctx.globalAlpha=life*fade;ctx.globalCompositeOperation='lighter';ctx.beginPath();ctx.moveTo(x-vx*.02,y-(vy+2*g*a)*.02);ctx.lineTo(x,y);ctx.stroke();}ctx.globalCompositeOperation='source-over';
    for(const p of smoke){const h=clamp((a-p.o*.6)/2.2);if(h<=0)continue;const [ux]=curl(p.x*2,h*2,env.seed);env.draw(SM[(p.v*6)|0],cx+p.x*S*.05+ux*S*.03*h+h*S*.05,cy-h*S*.35,S*(.05+.12*h),.45*(1-h)*fade);}}
   env.fill('rgb(200,210,255)',E*.45,'lighter');ctx.save();ctx.translate(cx,cy);ctx.scale(1,.42);env.draw(env.G.blue,0,0,env.trx*2.2,E*.7,'lighter');ctx.restore();
  }};}

  const env = makeEnv(canvas, opts), e = build(env);
  /* Owner 2026-11-04: the strike read "a tad bit too slow" — the whole timeline runs on a
   * 0.8x clock (3.6 s -> 2.88 s, 25% faster): every phase (leader, strikes, sparks, smoke,
   * fade) keeps its proportions, just compressed. The return stroke lands at 0.55 x 0.8 =
   * 0.44 s; fx.ts schedules the recorded thunder at that same 0.44 s (THUNDER_DELAY_S) —
   * change the two together. */
  const CLOCK = 0.8;
  function render(t) { t /= CLOCK; const { ctx, W, H } = env; ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0,0,W,H);
    const [sx, sy] = e.shake ? e.shake(t) : [0, 0];
    if (opts.drawScene) { ctx.save(); ctx.translate(sx, sy); opts.drawScene(ctx, W, H, t); ctx.restore(); env.sctx.clearRect(0,0,W,H); env.sctx.drawImage(canvas, 0, 0); }
    ctx.save(); ctx.translate(sx, sy); e.draw(t); ctx.restore(); finish(env, t); }
  function play(onEnd) { let t0 = null, id = 0; const step = now => { if (t0 === null) t0 = now; const t = (now - t0) / 1000;
      if (t >= e.duration * CLOCK) { env.ctx.clearRect(0,0,env.W,env.H); onEnd && onEnd(); return; } render(t); id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step); return () => cancelAnimationFrame(id); }
  return { duration: e.duration * CLOCK, render, play };
}
