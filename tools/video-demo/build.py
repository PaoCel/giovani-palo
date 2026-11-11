# Turn a screencast frame dir into a 30 fps mp4, trimmed between two marks.
import json, sys, subprocess, os, shutil, bisect
scene, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
pad_end = float(sys.argv[4]) if len(sys.argv) > 4 else 0
d = f"clips/{scene}"; m = json.load(open(f"{d}/meta.json"))
t0, t1 = m["marks"][start], m["marks"][end] + pad_end
fr = m["frames"]; ts = [f[1] for f in fr]
seq = f"{d}/seq"; shutil.rmtree(seq, ignore_errors=True); os.makedirs(seq)
n = int((t1 - t0) * 30)
for k in range(n):
    i = max(bisect.bisect_right(ts, t0 + k / 30) - 1, 0)
    os.symlink(os.path.abspath(f"{d}/{fr[i][0]}"), f"{seq}/{k:05d}.jpg")
out = f"clips/{scene}-{start}-{end}.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", f"{seq}/%05d.jpg",
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "medium", out], check=True)
print(out, round(n / 30, 2), "s")
