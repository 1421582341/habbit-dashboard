from PIL import Image
import os, shutil

src = "/tmp/jingling_out/jinglingtujian"
dst = os.path.expanduser("~/.hermes/scripts/infplife/sprites_web")

files = sorted(os.listdir(src))

for fname in files:
    if not fname.endswith(".png"):
        continue
    
    img = Image.open(os.path.join(src, fname))
    print(f"{fname}: original {img.size}")
    
    # Remove the white card background - find bbox of non-white, non-black content
    pix = img.load()
    w, h = img.size
    
    # The image has a white rounded card on transparent/black bg.
    # Find the content area (non-white, non-black pixels)
    mx, my = w, h
    Mx, My = 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            # Skip black (0,0,0) and white (>240) pixels
            if a > 0:
                is_white = r > 240 and g > 240 and b > 240
                is_black = r < 10 and g < 10 and b < 10
                if not is_white and not is_black:
                    mx = min(mx, x); Mx = max(Mx, x)
                    my = min(my, y); My = max(My, y)
    
    if Mx > mx and My > my:
        pad = (Mx - mx) // 6
        mx = max(0, mx - pad)
        Mx = min(w, Mx + pad)
        my = max(0, my - pad)
        My = min(h, My + pad)
        cropped = img.crop((mx, my, Mx, My))
    else:
        cropped = img
    
    # Make square
    cw, ch = cropped.size
    side = max(cw, ch)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(cropped, ((side-cw)//2, (side-ch)//2), cropped)
    
    # Resize to 200x200
    small = sq.resize((200, 200), Image.LANCZOS)
    
    # Save
    outpath = os.path.join(dst, fname)
    small.save(outpath, "PNG")
    print(f"  -> saved {outpath} ({os.path.getsize(outpath)} bytes)")

print("\nDone! All images processed.")
