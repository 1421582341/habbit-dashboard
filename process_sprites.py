from PIL import Image
import os

srcdir = os.path.expanduser("~/.hermes/scripts/infplife/sprites")
dstdir = os.path.expanduser("~/.hermes/scripts/infplife/sprites_web")

creatures = [
    ("warmegg","warmegg.jpg"),("sprout","sprout.jpg"),("clover3","clover3.jpg"),
    ("sevastar","sevastar.jpg"),("lightfloat","lightfloat.jpg"),
    ("cloudpuff","cloud.jpg"),("littlehorn","unicorn.jpg"),
    ("flamephoenix","firephoenix.jpg"),("fourleaf","fourleaf.jpg"),
    ("moonpie","sleepy.jpg"),("coffeebean","coffee.jpg"),
    ("snowball","snowball.jpg"),("candy","candy.jpg"),("mushroom","mushroom.jpg"),
    ("bell","bell.jpg"),("shell","shell.jpg"),("rainbow","rainbow.jpg"),("butterfly","butterfly.jpg")
]

TOLERANCE = 35

for cid, fname in creatures:
    path = os.path.join(srcdir, fname)
    img = Image.open(path).convert("RGBA")
    pix = img.load()
    w, h = img.size
    
    bg_r, bg_g, bg_b = 0, 0, 0
    samples = [(0,0),(w-1,0),(0,h-1),(w-1,h-1),(w//2,0),(0,h//2),(w-1,h//2)]
    for sx, sy in samples:
        r,g,b,a = pix[sx,sy]
        bg_r += r; bg_g += g; bg_b += b
    n = len(samples)
    bg_r //= n; bg_g //= n; bg_b //= n
    
    visited = [[False]*w for _ in range(h)]
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h-1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w-1, y))
    
    while stack:
        x, y = stack.pop()
        if x < 0 or x >= w or y < 0 or y >= h or visited[y][x]:
            continue
        r, g, b, a = pix[x, y]
        dr = abs(r - bg_r); dg = abs(g - bg_g); db = abs(b - bg_b)
        if dr > TOLERANCE or dg > TOLERANCE or db > TOLERANCE:
            continue
        visited[y][x] = True
        pix[x, y] = (r, g, b, 0)
        stack.extend([(x+1,y),(x-1,y),(x,y+1),(x,y-1)])
    
    mx, my = w, h
    Mx, My = 0, 0
    for y in range(h):
        for x in range(w):
            if pix[x,y][3] > 0:
                mx = min(mx, x); Mx = max(Mx, x)
                my = min(my, y); My = max(My, y)
    
    pad = max((Mx-mx), (My-my)) // 6
    mx = max(0, mx - pad); Mx = min(w, Mx + pad)
    my = max(0, my - pad); My = min(h, My + pad)
    
    cropped = img.crop((mx, my, Mx, My))
    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0,0,0,0))
    square.paste(cropped, ((side-cw)//2, (side-ch)//2), cropped)
    small = square.resize((120, 120), Image.LANCZOS)
    
    outpath = os.path.join(dstdir, f"{cid}.png")
    small.save(outpath, "PNG")
    sz = os.path.getsize(outpath)
    print(f"{cid}.png saved ({sz} bytes)")

print("\nDone!")
