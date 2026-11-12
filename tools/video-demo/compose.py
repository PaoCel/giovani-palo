# Assemble the promo videos from clips/*.mp4, plates/*.png and music.
# Run from the work dir (clips/, plates/ live there): python3 compose.py it en
# Pace rules: clips play at real speed, the first frame is held while the title
# appears, the last frame is held so the result can be read.
import subprocess, sys, os, json

FPS = 30
M = dict(phone=(1057, 120, 406, 879), desk=(716, 215, 1104, 690))
V = dict(phone=(228, 530, 624, 1350))
HOLD_IN, HOLD_OUT, FADE_D = 1.2, 1.6, 0.5
LIGHT, BLUE = "0xf2f8f9", "0x005581"
ENC = ["-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-crf", "17", "-preset", "medium"]


def run(cmd):
    subprocess.run(cmd, check=True)


def dur(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode())


def marks(scene):
    """Marks on the clip's own timeline (written by build.py)."""
    return json.load(open(f"clips/{scene}-ready-end.json"))


def cut(scene, ranges, out):
    """Keep only the given (start, end) ranges of clips/<scene>-ready-end.mp4."""
    src = f"clips/{scene}-ready-end.mp4"
    parts = [f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[p{i}]" for i, (a, b) in enumerate(ranges)]
    cat = "".join(f"[p{i}]" for i in range(len(ranges))) + f"concat=n={len(ranges)}:v=1:a=0[o]"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex", ";".join(parts) + ";" + cat, "-map", "[o]", *ENC, out])
    return out


def card(out, plate, D, size, color=BLUE):
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", str(D), "-i", plate, "-filter_complex",
         f"[0:v]scale={size},fps={FPS},fade=t=in:d={FADE_D}:color={color},fade=t=out:st={D - FADE_D}:d={FADE_D}:color={color},format=yuv420p",
         "-t", str(D), *ENC, out])
    return D


def media(out, bg, clip, frame, text, geo, mask=None, hold_in=HOLD_IN, hold_out=HOLD_OUT, fade_in=True, fade_out=True, text_in=True):
    """Device scene: background, clip (held at both ends), device frame, title."""
    x, y, w, h = geo
    D = round(hold_in + dur(clip) + hold_out, 2)
    inputs = ["-loop", "1", "-t", str(D), "-i", bg, "-i", clip, "-loop", "1", "-t", str(D), "-i", frame,
              "-loop", "1", "-t", str(D), "-i", text]
    f = [f"[1:v]scale={w}:{h}:flags=lanczos,tpad=start_mode=clone:start_duration={hold_in}:stop_mode=clone:stop_duration={hold_out + 1},"
         f"trim=duration={D},setpts=PTS-STARTPTS,fps={FPS}[c0]"]
    if mask:
        inputs += ["-loop", "1", "-t", str(D), "-i", mask]
        f.append(f"[4:v]scale={w}:{h},format=gray[m];[c0][m]alphamerge[c]")
    else:
        f.append("[c0]null[c]")
    f += [f"[0:v][c]overlay={x}:{y}[a]", "[a][2:v]overlay[b]",
          ("[3:v]format=rgba,fade=t=in:st=0.2:d=0.6:alpha=1[t]" if text_in else "[3:v]format=rgba[t]"), "[b][t]overlay[o]"]
    tail = "[o]" + (f"fade=t=in:d={FADE_D}:color={LIGHT}," if fade_in else "") + \
        (f"fade=t=out:st={D - FADE_D}:d={FADE_D}:color={LIGHT}," if fade_out else "") + "format=yuv420p"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(f) + ";" + tail, "-t", str(D), "-r", str(FPS), *ENC, out])
    return D


def concat(segs, out, music, total):
    lst = out + ".txt"
    open(lst, "w").write("".join(f"file '{os.path.abspath(s)}'\n" for s in segs))
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", music, "-filter_complex",
         f"[1:a]atrim=0:{total},volume=-4dB,afade=t=in:d=1,afade=t=out:st={total - 4}:d=4[a]", "-map", "0:v", "-map", "[a]",
         "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-crf", "18", "-preset", "slow",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{total:.2f}", out])


C = lambda s: f"clips/{s}-ready-end.mp4"
os.makedirs("segs", exist_ok=True); os.makedirs("out", exist_ok=True)
MUSIC = os.environ.get("MUSIC", "music.mp3")
DRY = os.environ.get("DRY")  # only print the planned durations

# register: skip the typing of the parent's fields
rm = marks("register")
REG = cut("register", [(0, rm["step2"] + 1.8), (rm["beforeConfirm"] - 0.4, rm["end"])], "clips/register-edit.mp4")
# teaser: the parent scene from the signature on
pm = marks("parent")
PAR_SIGN = cut("parent", [(pm["sign"] - 0.6, pm["end"])], "clips/parent-sign.mp4")
# registrations: stop on the open sheet, skip closing it
gm = marks("registrations")
REGS = cut("registrations", [(0, gm["sheet"] + 3.5)], "clips/registrations-edit.mp4")
# surveys: start where the results come into view, past the question editor
SURVEYS = cut("surveys", [(3.0, marks("surveys")["end"])], "clips/surveys-edit.mp4")
# stats: the unit and organization cards, not the list below
STATS = cut("stats", [(0, 14.0)], "clips/stats-edit.mp4")
# unit leader: the four boxes and the first rows, before it scrolls to the gallery
UNIT = cut("unithome", [(0, 11.5)], "clips/unithome-edit.mp4")

for L in [a for a in sys.argv[1:] if a in ("it", "en")] or ["it", "en"]:
    bg, fp, fd, mk = "plates/bg-main.png", "plates/frame-phone.png", "plates/frame-desk.png", "plates/mask-phone.png"
    t = lambda k: f"plates/{L}-text-{k}.png"
    segs, total = [], 0.0

    def add(name, fn, *a, **kw):
        global total
        p = f"segs/{L}-{name}.mp4"; segs.append(p); total += fn(p, *a, **kw)

    add("01hook", card, f"plates/{L}-hook.png", 5, "1920:1080")
    add("02regs", media, bg, REGS, fd, t("regs"), M["desk"])
    add("03stats", media, bg, STATS, fd, t("stats"), M["desk"])
    add("04surveys", media, bg, SURVEYS, fd, t("surveys"), M["desk"])
    add("05reg", media, bg, REG, fp, t("reg"), M["phone"], mk)
    add("06par", media, bg, PAR_SIGN, fp, t("par"), M["phone"], mk)
    add("07unit", media, bg, UNIT, fd, t("unit"), M["desk"])
    add("08rooms", media, bg, C("rooms"), fd, t("rooms"), M["desk"], hold_out=0.8, fade_out=False)
    add("09myroom", media, bg, C("myroom"), fp, t("rooms"), M["phone"], mk, hold_in=0.6, fade_in=False, text_in=False)
    add("10gallery", media, bg, C("gallery"), fp, t("gallery"), M["phone"], mk)
    add("11numbers", card, f"plates/{L}-numbers.png", 8, "1920:1080", color=LIGHT)
    add("12faq", card, f"plates/{L}-faq.png", 18, "1920:1080", color=LIGHT)
    add("13cta", card, f"plates/{L}-cta.png", 9, "1920:1080")
    print(L, "main", round(total, 1), "s")
    if not DRY:
        concat(segs, f"out/gugd-promo-{L}.mp4", MUSIC, total)

    # vertical teaser
    vb, vf, vm = "plates/bg-vert.png", "plates/frame-vphone.png", "plates/mask-vphone.png"
    vt = lambda k: f"plates/{L}-vtext-{k}.png"
    segs, total = [], 0.0
    add("v1hook", card, f"plates/{L}-vhook.png", 4, "1080:1920")
    add("v2reg", media, vb, REG, vf, vt("reg"), V["phone"], vm)
    add("v3room", media, vb, C("myroom"), vf, vt("rooms"), V["phone"], vm)
    add("v4gallery", media, vb, C("gallery"), vf, vt("gallery"), V["phone"], vm)
    add("v5cta", card, f"plates/{L}-vcta.png", 5, "1080:1920")
    print(L, "teaser", round(total, 1), "s")
    if not DRY:
        concat(segs, f"out/gugd-teaser-{L}.mp4", MUSIC, total)
