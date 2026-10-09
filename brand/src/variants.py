import sys, os, json, io, pathops, cairosvg
sys.path.insert(0, os.path.dirname(__file__))
import build
from build import contours, to_path, spade, svgd
from fontTools.pens.transformPen import TransformPen
D=pathops.PathOp.DIFFERENCE; U=pathops.PathOp.UNION
K=0.60  # corner handle factor (slightly squarer than a circle)

def rrect(x0,y0,x1,y1,rx,ry,left_r=0):
    """rect with rounded right corners (rx,ry); optional small left radius"""
    p=pathops.Path(); pen=p.getPen()
    l=left_r
    pen.moveTo((x0+l,y0)); pen.lineTo((x1-rx,y0))
    pen.curveTo((x1-rx+rx*K,y0),(x1,y0+ry-ry*K),(x1,y0+ry))
    pen.lineTo((x1,y1-ry))
    pen.curveTo((x1,y1-ry+ry*K),(x1-rx+rx*K,y1),(x1-rx,y1))
    pen.lineTo((x0+l,y1))
    if l: pen.curveTo((x0+l-l*K,y1),(x0,y1-l+l*K),(x0,y1-l))
    else: pen.lineTo((x0,y1))
    pen.lineTo((x0,y0+l))
    if l: pen.curveTo((x0,y0+l-l*K),(x0+l-l*K,y0),(x0+l,y0))
    pen.closePath(); return p

def rect(x0,y0,x1,y1):
    p=pathops.Path(); pen=p.getPen()
    pen.moveTo((x0,y0)); pen.lineTo((x1,y0)); pen.lineTo((x1,y1)); pen.lineTo((x0,y1)); pen.closePath(); return p

def op(a,b,o): return pathops.op(a,b,o)

def B_outer(notch, top_r=(190,165), bot_r=(205,180), xr_top=722, xr_bot=738):
    """B silhouette: two bowls meeting at y=notch"""
    bot=rrect(74,0,xr_bot,notch+20,*bot_r)
    top=rrect(74,notch-20,xr_top,688,*top_r)
    o=op(bot,top,U)
    # crisp notch: carve a small V at the junction on the right
    return o

def font_glyph(ch): return to_path(contours(ch))

def assemble(glyphs, gaps):
    out=pathops.Path(); x=None; prev=None
    for i,p in enumerate(glyphs):
        b=p.bounds
        x = -b[0] if prev is None else prev + gaps[i-1] - b[0]
        q=pathops.Path(); p.draw(TransformPen(q.getPen(),(1,0,0,1,x,0)))
        out=op(out,q,U); prev=x+b[2]
    return out

def emit(name, path, note):
    d_=f"variants/{name}"; os.makedirs(d_,exist_ok=True)
    x0,y0,x1,y1=path.bounds; W=x1-x0; H=y1-y0
    d=svgd(path,1,-x0,0)
    hdr='<?xml version="1.0" encoding="UTF-8"?>\n'
    for col,fn in (("#000000","bwm-wordmark-black.svg"),("#FFFFFF","bwm-wordmark-white.svg")):
        open(f"{d_}/{fn}","w").write(hdr+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H:g}" width="{W/4:g}" height="{H/4:g}" role="img" aria-label="Bid Wit Me">\n<title>Bid Wit Me</title>\n<path fill="{col}" d="{d}"/>\n</svg>\n')
    S=1024; sc=S*0.74/W
    di=svgd(path,sc,-x0*sc+(S-W*sc)/2,(S-H*sc)/2)
    icon=hdr+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="Bid Wit Me">\n<title>Bid Wit Me</title>\n<rect width="{S}" height="{S}" fill="#111111"/>\n<path fill="#FFFFFF" d="{di}"/>\n</svg>\n'
    open(f"{d_}/bwm-icon.svg","w").write(icon)
    for z in (1024,180,32):
        cairosvg.svg2png(bytestring=icon.encode(),write_to=f"{d_}/bwm-icon-{z}.png",output_width=z,output_height=z)
    open(f"{d_}/NOTE.txt","w").write(note+"\n")

W_=font_glyph("W"); M_=font_glyph("M")
GAPS=(34,40)

# ---------- A: spade in bottom bowl, optically centred; top counter matched ----------
def variant_A(pr):
    notch=pr.get('notch',372)
    B=B_outer(notch)
    h=pr['h']; cx=pr['cx']; base=pr['base']
    sp=spade(cx,base,h,0.25)
    hw=0.46*h
    # top counter: square-left, rounded-right, same width as spade, same left edge
    ct=rrect(cx-hw, pr['ct_y0'], cx+hw, pr['ct_y1'], pr['ct_r'], (pr['ct_y1']-pr['ct_y0'])/2)
    B=op(op(B,sp,D),ct,D)
    return B

# ---------- B: one big spade = the heart of the B (no counters) ----------
def variant_B(pr):
    B=B_outer(pr.get('notch',352))
    sp=spade(pr['cx'],pr['base'],pr['h'],0.25)
    return op(B,sp,D)

# ---------- C: spade in TOP bowl, normal bottom counter ----------
def variant_C(pr):
    notch=pr['notch']
    B=B_outer(notch, top_r=(200,190), bot_r=(190,160), xr_top=730, xr_bot=730)
    sp=spade(pr['cx'],pr['base'],pr['h'],0.25)
    hw=0.46*pr['h']
    cb=rrect(cx0:=pr['cx']-hw, pr['cb_y0'], pr['cx']+hw+pr.get('cb_extra',0), pr['cb_y1'], pr['cb_r'], (pr['cb_y1']-pr['cb_y0'])/2)
    return op(op(B,sp,D),cb,D)

# ---------- D: font B untouched; W's lower middle negative space becomes a spade ----------
def variant_D(pr):
    h=pr['h']; cx=500; lift=pr['lift']
    body=spade(cx,lift,h,0.25)
    # long stem with concave flare, running out through the baseline
    nk=0.045*h; fw=pr['foot']; top=lift+0.28*h
    st=pathops.Path(); pen=st.getPen()
    pen.moveTo((cx-nk,top)); pen.lineTo((cx+nk,top))
    pen.curveTo((cx+nk,lift*0.5),(cx+fw*0.35,0),(cx+fw,-1))
    pen.lineTo((cx+fw,-60)); pen.lineTo((cx-fw,-60)); pen.lineTo((cx-fw,-1))
    pen.curveTo((cx-fw*0.35,0),(cx-nk,lift*0.5),(cx-nk,top)); pen.closePath()
    notch=pathops.Path(); pen=notch.getPen()
    pen.moveTo((409,0)); pen.lineTo((591,0)); pen.lineTo((502,419)); pen.lineTo((498,419)); pen.closePath()
    W=op(font_glyph("W"),notch,U)
    W=op(op(W,body,D),st,D)
    W=op(W,rect(-50,-100,1100,0),D)
    return W, font_glyph("B")

P={
 'A':dict(h=248,cx=410,base=122,ct_y0=462,ct_y1=560,ct_r=52,notch=380),
 'B':dict(h=366,cx=414,base=150,notch=352),
 'C':dict(notch=318,h=226,cx=405,base=368,cb_y0=138,cb_y1=232,cb_r=48),
 'D':dict(h=320,lift=70,foot=70),
}
if __name__=="__main__":
    if len(sys.argv)>1: 
        for k,v in json.loads(sys.argv[1]).items(): P[k].update(v)
    notes={'A':"Spade replaces the bottom counter, optically centred with more breathing room; top counter resized to the spade's width and aligned on its axis.",
           'B':"One large spade cut through the whole B (no counters): the B silhouette with a spade heart.",
           'C':"Spade replaces the top counter; ordinary bottom counter matched to its width.",
           'D':"Classic Archivo B; the W's lower middle negative space becomes a spade opening out through the baseline."}
    for k in "ABC":
        Bp=globals()['variant_'+k](P[k])
        emit(k, assemble([Bp,W_,M_],GAPS), notes[k])
    Wd,Bf=variant_D(P['D'])
    emit('D', assemble([Bf,Wd,M_],GAPS), notes['D'])
