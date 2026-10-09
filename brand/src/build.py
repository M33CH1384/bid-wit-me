import pathops, cairosvg, sys, json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen, DecomposingRecordingPen

FONT="/usr/share/fonts/truetype/sand-box/google/Archivo Black/ArchivoBlack-Regular.ttf"
P=dict(sp_cx=430, sp_base=112, sp_h=272, cnt_shift=22, gap_BW=34, gap_WM=40, stemw=0.24)
P.update(json.loads(sys.argv[1]) if len(sys.argv)>1 else {})
f=TTFont(FONT); gs=f.getGlyphSet(); cmap=f.getBestCmap()

def contours(ch):
    r=RecordingPen(); gs[cmap[ord(ch)]].draw(r)
    out=[];cur=[]
    for op,a in r.value:
        cur.append((op,a))
        if op in('closePath','endPath'): out.append(cur);cur=[]
    return out
def to_path(recs, dx=0, dy=0):
    p=pathops.Path(); pen=TransformPen(p.getPen(),(1,0,0,1,dx,dy))
    for rec in recs:
        for op,a in rec: getattr(pen,op)(*a)
    return p

def spade(cx, base, h, sw):
    # normalized spade, y up, height 1, symmetric about x=0
    R=[("moveTo",[(0,1)]),
       ("curveTo",[(0.10,0.87),(0.46,0.68),(0.46,0.43)]),
       ("curveTo",[(0.46,0.27),(0.35,0.17),(0.23,0.17)]),
       ("curveTo",[(0.14,0.17),(0.07,0.21),(0.035,0.265)]),
       ("curveTo",[(0.045,0.14),(0.10,0.05),(sw,0)]),
       ("lineTo",[(-sw,0)]),
       ("curveTo",[(-0.10,0.05),(-0.045,0.14),(-0.035,0.265)]),
       ("curveTo",[(-0.07,0.21),(-0.14,0.17),(-0.23,0.17)]),
       ("curveTo",[(-0.35,0.17),(-0.46,0.27),(-0.46,0.43)]),
       ("curveTo",[(-0.46,0.68),(-0.10,0.87),(0,1)]),
       ("closePath",[])]
    p=pathops.Path(); pen=p.getPen()
    for op,pts in R:
        getattr(pen,op)(*[(cx+x*h, base+y*h) for x,y in pts])
    return p

def build():
    cB=contours("B")  # 0 outer, 1 upper counter, 2 lower counter
    B=to_path([cB[0]])
    upper=to_path([cB[1]],0,P['cnt_shift'])
    B=pathops.op(B,upper,pathops.PathOp.DIFFERENCE)
    B=pathops.op(B,spade(P['sp_cx'],P['sp_base'],P['sp_h'],P['stemw']),pathops.PathOp.DIFFERENCE)
    glyphs=[];x=0
    for ch in "BWM":
        g=gs[cmap[ord(ch)]]
        if ch=="B": p=B; lsb=0
        else: p=to_path(contours(ch))
        b=p.bounds
        if glyphs: x=prev_right+P['gap_'+prev_ch+ch]-b[0]
        glyphs.append((p,x)); prev_right=x+b[2]; prev_ch=ch
    # combine
    allp=pathops.Path()
    for p,dx in glyphs:
        q=pathops.Path(); p.draw(TransformPen(q.getPen(),(1,0,0,1,dx,0)))
        allp=pathops.op(allp,q,pathops.PathOp.UNION)
    return allp

def svgd(p, s=1.0, dx=0, dy=0, H=688):
    pen=SVGPathPen(None, ntos=lambda v: ("%.2f"%v).rstrip('0').rstrip('.'))
    p.draw(TransformPen(pen,(s,0,0,-s,dx,dy+H*s)))
    return pen.getCommands()

if __name__=="__main__":
    p=build()
    xmin,ymin,xmax,ymax=p.bounds
    print("bounds",p.bounds)
    json.dump({"bounds":[xmin,ymin,xmax,ymax]},open("/dev/null","w"))
    open("scratch/mark.d","w").write(svgd(p,1,-xmin,0))
    W=xmax-xmin
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -60 {W+120} 808"><path d="{svgd(p,1,-xmin,0)}"/></svg>'
    cairosvg.svg2png(bytestring=svg.encode(),write_to="scratch/test.png",output_width=1000,background_color="white")
    cairosvg.svg2png(bytestring=svg.encode(),write_to="scratch/test_small.png",output_width=60,background_color="white")
