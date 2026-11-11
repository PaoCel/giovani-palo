# Assemble the promo videos from clips/*.mp4, plates/*.png and music.
import subprocess, sys, os, json
FPS = 30
M = dict(phone=(1057, 120, 406, 879), desk=(716, 215, 1104, 690))
V = dict(phone=(228, 530, 624, 1350))
def dur(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode())
def run(cmd):
    subprocess.run(cmd, check=True)
FADE = "color=0xf2f8f9"
def card(out, plate, D, size, color="0x005581"):
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", str(D), "-i", plate, "-filter_complex",
         f"[0:v]scale={size},fps={FPS},fade=t=in:d=0.4:color={color},fade=t=out:st={D-0.35}:d=0.35:color={color},format=yuv420p", "-t", str(D), "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-crf", "17", "-preset", "medium", out])
def media(out, bg, clip, frame, text, D, geo, size, start=0.0, speed=1.0, text_delay=0.15, fade_in=True, fade_out=True):
    x, y, w, h = geo
    src = dur(clip)
    f = [f"[1:v]trim=start={start},setpts=(PTS-STARTPTS)/{speed},scale={w}:{h}:flags=lanczos:in_range=pc:out_range=pc,tpad=stop_mode=clone:stop_duration={D+2},trim=duration={D},setpts=PTS-STARTPTS,fps={FPS}[c]",
         "[0:v][c]overlay=" + f"{x}:{y}" + "[a]", "[a][2:v]overlay[b]",
         ("[3:v]format=rgba[t]" if text_delay is None else f"[3:v]format=rgba,fade=t=in:st={text_delay}:d=0.5:alpha=1[t]"), "[b][t]overlay[o]"]
    tail = "[o]" + (f"fade=t=in:d=0.3:{FADE}," if fade_in else "") + (f"fade=t=out:st={D-0.3}:d=0.3:{FADE}," if fade_out else "") + "format=yuv420p"
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", str(D), "-i", bg, "-i", clip, "-loop", "1", "-t", str(D), "-i", frame,
         "-loop", "1", "-t", str(D), "-i", text, "-filter_complex", ";".join(f) + ";" + tail, "-t", str(D), "-r", str(FPS),
         "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-crf", "17", "-preset", "medium", out])
def fit(clip, D, extra=0.0):
    """speed so that the clip fills D seconds (never slower than 1x; freeze covers the rest)"""
    return max(dur(clip) / max(D - extra, 0.1), 1.0)
def concat(segs, out, music, total, mvol="-4dB"):
    lst = out + ".txt"
    open(lst, "w").write("".join(f"file '{os.path.abspath(s)}'\n" for s in segs))
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", music, "-filter_complex",
         f"[1:a]atrim=0:{total},volume={mvol},afade=t=in:d=1,afade=t=out:st={total-3}:d=3[a]", "-map", "0:v", "-map", "[a]",
         "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", str(total), out])
os.makedirs("segs", exist_ok=True); os.makedirs("out", exist_ok=True)
C = lambda s: f"clips/{s}-ready-end.mp4"
for L in sys.argv[1:] or ["it", "en"]:
    bg, fp, fd = "plates/bg-main.png", "plates/frame-phone.png", "plates/frame-desk.png"
    t = lambda k: f"plates/{L}-text-{k}.png"
    s = []
    def seg(name): p = f"segs/{L}-{name}.mp4"; s.append(p); return p
    card(seg("01hook"), f"plates/{L}-hook.png", 5, "1920:1080")
    media(seg("02reg"), bg, C("register"), fp, t("reg"), 10, M["phone"], None, speed=fit(C("register"), 10, 0.6))
    media(seg("03par"), bg, C("parent"), fp, t("par"), 10, M["phone"], None, speed=fit(C("parent"), 10, 0.8))
    media(seg("04pdf"), bg, C("consents"), fd, t("pdf"), 7, M["desk"], None)
    media(seg("05leader"), bg, C("leader"), fd, t("leader"), 13, M["desk"], None)
    media(seg("06rooms"), bg, C("rooms"), fd, t("rooms"), 6.5, M["desk"], None, speed=fit(C("rooms"), 6.5, 0.2), fade_out=False)
    media(seg("07myroom"), bg, C("myroom"), fp, t("rooms"), 6.5, M["phone"], None, text_delay=None, fade_in=False)
    media(seg("08gallery"), bg, C("gallery"), fp, t("gallery"), 9, M["phone"], None)
    media(seg("09quick"), bg, C("quick"), fd, t("quick"), 6, M["desk"], None, speed=fit(C("quick"), 6, 0.3))
    card(seg("10numbers"), f"plates/{L}-numbers.png", 8, "1920:1080", color="0xf2f8f9")
    card(seg("11cta"), f"plates/{L}-cta.png", 9, "1920:1080")
    concat(s, f"out/gugd-promo-90s-{L}.mp4", os.environ.get("MUSIC", "music.mp3"), 90)
    # vertical teaser
    vb, vf = "plates/bg-vert.png", "plates/frame-vphone.png"
    vt = lambda k: f"plates/{L}-vtext-{k}.png"
    s = []
    card(seg("v1hook"), f"plates/{L}-vhook.png", 4, "1080:1920")
    media(seg("v2par"), vb, C("parent"), vf, vt("par"), 12, V["phone"], None, speed=fit(C("parent"), 12, 0.8))
    media(seg("v3room"), vb, C("myroom"), vf, vt("rooms"), 6, V["phone"], None, speed=fit(C("myroom"), 6, 0.3))
    media(seg("v4gallery"), vb, C("gallery"), vf, vt("gallery"), 4, V["phone"], None, start=1.5, speed=fit(C("gallery"), 5.5, 0.3))
    card(seg("v5cta"), f"plates/{L}-vcta.png", 4, "1080:1920")
    concat(s, f"out/gugd-teaser-30s-{L}.mp4", os.environ.get("MUSIC", "music.mp3"), 30)
    print("done", L)
