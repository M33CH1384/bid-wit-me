import cairosvg,io,sys
from PIL import Image
tag=sys.argv[1]
ims=[]
for k in 'ABCD':
    im=Image.open(io.BytesIO(cairosvg.svg2png(url=f'variants/{k}/bwm-wordmark-black.svg',output_width=1000,background_color='white')))
    ims.append(im.crop((0,0,500 if k!='D' else 700,im.height)))
s=Image.new('RGB',(1220,2*ims[0].height+20),'#c00')
s.paste(ims[0],(0,0)); s.paste(ims[1],(520,0)); s.paste(ims[2],(0,ims[0].height+20)); s.paste(ims[3],(520,ims[0].height+20))
s.save(f'variants/z{tag}.png')
