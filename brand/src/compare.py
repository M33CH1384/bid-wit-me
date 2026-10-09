import io, sys, cairosvg
from PIL import Image, ImageDraw, ImageFont
FB=ImageFont.truetype("/usr/share/fonts/truetype/sand-box/google/Archivo Black/ArchivoBlack-Regular.ttf",56)
F=ImageFont.truetype("/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf",26)
out=sys.argv[1] if len(sys.argv)>1 else "variants/compare.png"
rowh=420; Wd=2000
sheet=Image.new("RGB",(Wd,rowh*4+40),"white"); d=ImageDraw.Draw(sheet)
for i,k in enumerate("ABCD"):
    y=20+i*rowh
    wm=Image.open(io.BytesIO(cairosvg.svg2png(url=f"variants/{k}/bwm-wordmark-black.svg",output_width=1080))).convert("RGBA")
    d.text((30,y+20),k,fill="black",font=FB)
    sheet.paste(wm,(130,y+30),wm)
    note=open(f"variants/{k}/NOTE.txt").read().strip()
    d.text((130,y+rowh-85),note,fill="#555",font=F)
    ic=Image.open(f"variants/{k}/bwm-icon-180.png"); sheet.paste(ic,(1400,y+60))
    ic32=Image.open(f"variants/{k}/bwm-icon-32.png"); sheet.paste(ic32,(1610,y+60))
    sm=Image.open(io.BytesIO(cairosvg.svg2png(url=f"variants/{k}/bwm-wordmark-black.svg",output_width=200))).convert("RGBA"); sheet.paste(sm,(1670,y+60),sm)
    d.text((1400,y+250),"180 px icon · 32 px · 200 px wide",fill="#888",font=F)
    if i: d.line((20,y-5,Wd-20,y-5),fill="#ddd",width=2)
sheet.save(out)
