import json, cairosvg, os, pathops
import build
build.P.update({"sp_h":292,"sp_base":106,"stemw":0.25,"cnt_shift":34,"sp_cx":436})
p=build.build()
x0,y0,x1,y1=p.bounds; W=x1-x0; H=y1-y0
d=build.svgd(p,1,-x0,0)
hdr='<?xml version="1.0" encoding="UTF-8"?>\n'
def wordmark(color,name):
    s=hdr+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H:g}" width="{W/4:g}" height="{H/4:g}" role="img" aria-label="Bid Wit Me">\n<title>Bid Wit Me</title>\n<path fill="{color}" d="{d}"/>\n</svg>\n'
    open(name,'w').write(s); return s
wordmark("#000000","bwm-wordmark-black.svg")
wordmark("#FFFFFF","bwm-wordmark-white.svg")
S=1024; frac=0.74; sc=S*frac/W
dx=(S-W*sc)/2; dy=(S-H*sc)/2
di=build.svgd(p,sc,-x0*sc+dx,dy)
def icon(bg,fg,name):
    s=hdr+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="Bid Wit Me">\n<title>Bid Wit Me</title>\n<rect width="{S}" height="{S}" fill="{bg}"/>\n<path fill="{fg}" d="{di}"/>\n</svg>\n'
    open(name,'w').write(s); return s
icons={"bwm-icon":icon("#111111","#FFFFFF","bwm-icon.svg"),
       "bwm-icon-light":icon("#FFFFFF","#000000","bwm-icon-light.svg")}
os.makedirs("png",exist_ok=True)
for n,s in icons.items():
    for z in (1024,512,180,64,32,16):
        cairosvg.svg2png(bytestring=s.encode(),write_to=f"png/{n}-{z}.png",output_width=z,output_height=z)
# small-size monogram: B with spade only
B=build.to_path([build.contours("B")[0]])
B=pathops.op(B,build.to_path([build.contours("B")[1]],0,build.P['cnt_shift']),pathops.PathOp.DIFFERENCE)
B=pathops.op(B,build.spade(436,106,292,0.25),pathops.PathOp.DIFFERENCE)
bx0,_,bx1,_=B.bounds; bw=bx1-bx0; sc2=S*0.58/688
db=build.svgd(B,sc2,-bx0*sc2+(S-bw*sc2)/2,(S-688*sc2)/2)
bs=hdr+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="Bid Wit Me">\n<title>Bid Wit Me</title>\n<rect width="{S}" height="{S}" fill="#111111"/>\n<path fill="#FFFFFF" d="{db}"/>\n</svg>\n'
open("bwm-monogram-b-icon.svg","w").write(bs)
for z in (180,32,16): cairosvg.svg2png(bytestring=bs.encode(),write_to=f"png/bwm-monogram-b-icon-{z}.png",output_width=z,output_height=z)
json.dump({"W":W,"H":H},open("scratch/dims.json","w"))
