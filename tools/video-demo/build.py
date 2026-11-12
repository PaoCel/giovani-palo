# Turn a screencast frame dir into a 30 fps mp4 between two marks.
# Motion plays at real speed; a still screen lasts at most MAXSTILL seconds
# (LASTSTILL for the final screen), so waits for the network don't drag.
# Writes clips/<scene>-<start>-<end>.mp4 and .json (marks on the new timeline).
import json, sys, subprocess, os, shutil, bisect

scene, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
MAXSTILL = float(os.environ.get("MAXSTILL", 1.8))
LASTSTILL = float(os.environ.get("LASTSTILL", 2.5))
d = f"clips/{scene}"; m = json.load(open(f"{d}/meta.json"))
t0, t1 = m["marks"][start], m["marks"][end]
fr = m["frames"]
# frames shown in the window: the one on screen at t0, then every later frame before t1
i0 = max([i for i, f in enumerate(fr) if f[1] <= t0] or [0])
shown = [(fr[i0][0], t0)] + [(f, t) for f, t in fr[i0 + 1:] if t < t1]
# new timeline: each gap is capped
new_t, acc = [], 0.0
for k, (f, t) in enumerate(shown):
    new_t.append(acc)
    nxt = shown[k + 1][1] if k + 1 < len(shown) else t1
    cap = LASTSTILL if k + 1 == len(shown) else MAXSTILL
    acc += min(nxt - t, cap)
total = acc
old_t = [t for _, t in shown]


def remap(t):
    """Map an original timestamp onto the compressed timeline."""
    k = max(bisect.bisect_right(old_t, t) - 1, 0)
    nxt = old_t[k + 1] if k + 1 < len(old_t) else t1
    cap = LASTSTILL if k + 1 == len(old_t) else MAXSTILL
    return new_t[k] + min(t - old_t[k], cap, nxt - old_t[k])


seq = f"{d}/seq"; shutil.rmtree(seq, ignore_errors=True); os.makedirs(seq)
n = int(total * 30)
for j in range(n):
    k = max(bisect.bisect_right(new_t, j / 30) - 1, 0)
    os.symlink(os.path.abspath(f"{d}/{shown[k][0]}"), f"{seq}/{j:05d}.jpg")
out = f"clips/{scene}-{start}-{end}"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", f"{seq}/%05d.jpg",
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-pix_fmt", "yuv420p", "-color_range", "tv",
  "-c:v", "libx264", "-crf", "16", "-preset", "medium", out + ".mp4"], check=True)
marks = {k: round(remap(v), 3) for k, v in m["marks"].items() if t0 <= v <= t1}
json.dump(marks, open(out + ".json", "w"))
print(out + ".mp4", round(t1 - t0, 2), "->", round(n / 30, 2), "s", marks)
