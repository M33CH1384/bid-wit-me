import cairosvg, io
from PIL import Image, ImageDraw, ImageFont
F=ImageFont.truetype("/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf",28)
def svgimg(path,w):
    return Image.open(io.BytesIO(cairosvg.svg2png(url=path,output_width=w))).convert("RGBA")
Wd=2600; sheet=Image.new("RGB",(Wd,2050),"#e9e9e9"); d=ImageDraw.Draw(sheet)
# wordmarks
sheet.paste((255,255,255),(0,0,Wd//2,520)); sheet.paste((17,17,17),(Wd//2,0,Wd,520))
for i,(f,lab,c) in enumerate([("bwm-wordmark-black.svg","Wordmark on light","#555"),("bwm-wordmark-white.svg","Wordmark on dark","#aaa")]):
    im=svgimg(f,1000); x=i*Wd//2+(Wd//2-im.width)//2; sheet.paste(im,(x,(520-im.height)//2),im)
    d.text((i*Wd//2+30,20),lab,fill=c,font=F)
    sm=svgimg(f,120); sheet.paste(sm,(i*Wd//2+30,440),sm)
    d.text((i*Wd//2+170,450),"(120 px wide)",fill=c,font=F)
y=580
d.text((40,y),"App icon — 1024 / 180 / 32 / 16 px (actual size), plus 32 & 16 enlarged 8x",fill="#333",font=F)
y+=60; x=40
for n,yy in (("bwm-icon",y),):
    big=Image.open("png/bwm-icon-1024.png"); sheet.paste(big,(x,yy)); xx=x+1024+60
    for z in (180,32,16):
        im=Image.open(f"png/bwm-icon-{z}.png"); sheet.paste(im,(xx,yy)); d.text((xx,yy+z+10),f"{z}",fill="#333",font=F); xx+=z+60
    for z in (32,16):
        im=Image.open(f"png/bwm-icon-{z}.png").resize((z*8,z*8),Image.NEAREST); sheet.paste(im,(xx,yy)); d.text((xx,yy+z*8+10),f"{z} @8x",fill="#333",font=F); xx+=z*8+60
    yy2=yy+420; xx=x+1024+60
    d.text((xx,yy2-50),"Light variant",fill="#333",font=F)
    for z in (180,32,16):
        im=Image.open(f"png/bwm-icon-light-{z}.png"); sheet.paste(im,(xx,yy2)); xx+=z+60
    for z in (32,16):
        im=Image.open(f"png/bwm-icon-light-{z}.png").resize((z*8,z*8),Image.NEAREST); sheet.paste(im,(xx,yy2)); xx+=z*8+60
    yy3=yy2+330; xx=x+1024+60
    d.text((xx,yy3-50),"Optional B-monogram for tiny sizes / favicon",fill="#333",font=F)
    for z in (180,32,16):
        im=Image.open(f"png/bwm-monogram-b-icon-{z}.png"); sheet.paste(im,(xx,yy3)); xx+=z+60
    for z in (32,16):
        im=Image.open(f"png/bwm-monogram-b-icon-{z}.png").resize((z*8,z*8),Image.NEAREST); sheet.paste(im,(xx,yy3)); xx+=z*8+60
sheet.save("preview.png")
