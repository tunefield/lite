#!/usr/bin/env python3
"""Render MANUAL.md into the shipped HTML user guide (static/manual.html).

MANUAL.md is the SOURCE — edit it, run this, commit both. The app serves the
result at /manual, so whatever ships in a build is whatever was committed.

    python3 scripts/build_manual.py

Needs the `markdown` package (build-time only, never at runtime):
    pip install markdown

Markers the builder expands (HTML comments, so the .md stays clean everywhere else):
    <!-- curves:gallery -->   the Set-builder curve shapes, drawn live from the
                              same functions the app uses (small JS block)
"""
import os, re, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "MANUAL.md")
OUT = os.path.join(ROOT, "static", "manual.html")

try:
    import markdown
except ImportError:
    sys.exit("The `markdown` package is needed to build the manual: pip install markdown")

md_text = open(SRC, encoding="utf-8").read()
version = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()

# GitHub-style anchors so MANUAL.md's own Contents links keep working.
def slugify(text, sep):
    text = re.sub(r"[^\w\s-]", "", text.lower().replace("&", ""))
    # GitHub does NOT collapse runs of spaces — "Keyboard & FPS" → keyboard--fps
    return re.sub(r"\s", sep, text.strip())

body = markdown.markdown(
    md_text,
    extensions=["tables", "sane_lists", "toc"],
    extension_configs={"toc": {"slugify": slugify, "permalink": False}},
)

# ── marker: the live-drawn curve gallery ─────────────────────────────────────
CURVES_HTML = """
<div class="curves" id="tf-curves"></div>
<script>
// Drawn from the SAME functions the app uses — the pictures cannot drift.
const TF_CURVES = [
  ['Flat','One steady level, start to finish.',false,(t,i,c)=>0.6],
  ['Build','A straight, patient climb.',false,(t,i,c)=>0.25+0.65*t],
  ['Cool-down','A straight, graceful descent.',false,(t,i,c)=>0.9-0.65*t],
  ['Peak','Rise to the middle, release to the end.',false,(t,i,c)=>0.25+0.65*Math.sin(Math.PI*t)],
  ['Valley','Dip in the middle, return by the end.',false,(t,i,c)=>0.9-0.65*Math.sin(Math.PI*t)],
  ['Waves','Up and down, one wave per Cycle tracks.',true,(t,i,c)=>0.55+0.35*Math.sin(2*Math.PI*i/c)],
  ['Slow burn','Restrained for most of the night, explosive late.',false,(t,i,c)=>0.25+0.65*Math.pow(t,2.2)],
  ['Prime time','Fast rise, long high plateau, gentle final dip.',false,(t,i,c)=>0.3+0.6*Math.min(1,t*4)-0.35*Math.max(0,(t-0.85)*4)],
  ['Rolling build','A climb that breathes in Cycle-length waves.',true,(t,i,c)=>0.25+0.5*t+0.12*Math.sin(2*Math.PI*i/c)],
  ['Tension & release','Ramps up over each Cycle, drops, rebuilds.',true,(t,i,c)=>0.3+0.55*((i/c)-Math.floor(i/c))],
  ['False ending','A big peak, a dive as if it\\u2019s over \\u2014 then one last surge.',false,
     (t,i,c)=>t<0.66 ? 0.28+0.62*Math.sin(Math.PI*0.5*t/0.66) : t<0.82 ? 0.9-3.4*(t-0.66) : 0.36+0.54*Math.sin(Math.PI*(t-0.82)/0.36)],
];
const tfHost = document.getElementById('tf-curves');
for (const [name, desc, usesCyc, fn] of TF_CURVES) {
  const W=180,H=44,N=40,pts=[];
  for (let x=0;x<=N;x++){const t=x/N,v=Math.max(0,Math.min(1,fn(t,t*32,8)));
    pts.push(`${(4+(W-8)*t).toFixed(1)},${(H-5-(H-10)*v).toFixed(1)}`);}
  const el=document.createElement('div'); el.className='curve';
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke="#20706F" stroke-width="2.2" stroke-linecap="round"/>
    </svg><b>${name}${usesCyc?' <span class="cyc">\\u00b7 cycle</span>':''}</b><span>${desc}</span>`;
  tfHost.appendChild(el);
}
</script>
"""
body = body.replace("<!-- curves:gallery -->", CURVES_HTML)

# Cross-file .md links (MISSION.md, QUICKSTART.md) 404 at /manual — those files are
# neither routed nor bundled. Unwrap them to plain <code> text; the .md source keeps
# its links for GitHub readers.
body = re.sub(r'<a href="([A-Za-z0-9_-]+\.md)">(.*?)</a>', r"<code>\1</code>", body)

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tunefield Manual</title>
<!-- GENERATED from MANUAL.md by scripts/build_manual.py — edit the .md, not this file. -->
<style>
  :root{{
    --paper:#F6F2E9; --card:#FBF8F1; --ink:#1C1A16; --body:#3A362E;
    --muted:#7A7466; --line:#D8D2C2;
    --teal:#20706F; --rust:#B4472F; --mustard:#B07C10;
  }}
  *{{box-sizing:border-box}}
  body{{margin:0; background:var(--paper); color:var(--body);
    font-family:"Avenir Next","Avenir","Futura","Century Gothic","Nunito Sans",system-ui,sans-serif;
    font-size:16.5px; line-height:1.62; -webkit-font-smoothing:antialiased}}
  .wrap{{max-width:46rem; margin:0 auto; padding:0 1.4rem 5rem}}
  .masthead{{padding:2.8rem 0 1.4rem; border-bottom:2px solid var(--ink); margin-bottom:2rem}}
  .brand{{font-weight:700; color:var(--ink)}} .brand b{{color:var(--rust)}}
  .ver{{color:var(--muted); font-size:.85rem; margin-top:.2rem}}
  h1{{font-size:clamp(1.8rem,5vw,2.4rem); color:var(--ink); letter-spacing:-.015em;
     line-height:1.1; margin:1.2rem 0 .6rem; text-wrap:balance}}
  h2{{font-size:1.25rem; color:var(--ink); margin:2.4rem 0 .7rem; padding-top:1.2rem;
     border-top:1px solid var(--line); letter-spacing:-.01em}}
  h3{{font-size:1.02rem; color:var(--teal); margin:1.6rem 0 .4rem;
     text-transform:uppercase; letter-spacing:.09em; font-size:.82rem}}
  h4{{font-size:.98rem; color:var(--ink); margin:1.2rem 0 .3rem}}
  p{{margin:0 0 .9rem}} strong{{color:var(--ink)}}
  a{{color:var(--teal); text-underline-offset:2px}}
  code{{font-family:ui-monospace,Menlo,monospace; font-size:.85em; background:var(--card);
    border:1px solid var(--line); padding:.06em .35em; color:var(--ink)}}
  pre{{background:var(--card); border:1px solid var(--line); padding:.8rem 1rem;
    overflow-x:auto; font-size:.85rem}} pre code{{border:none; padding:0}}
  ul,ol{{margin:0 0 1rem; padding-left:1.2rem}} li{{margin-bottom:.35rem}}
  hr{{border:none; border-top:1px solid var(--line); margin:2rem 0}}
  table{{border-collapse:collapse; width:100%; font-size:.9rem; background:var(--card);
    margin:0 0 1rem; display:block; overflow-x:auto}}
  th{{font-size:.68rem; letter-spacing:.1em; text-transform:uppercase; text-align:left;
     color:var(--muted); padding:.5rem .75rem; border:1px solid var(--line)}}
  td{{padding:.5rem .75rem; border:1px solid var(--line); vertical-align:top}}
  blockquote{{margin:0 0 1rem; padding:.6rem 1rem; border-left:4px solid var(--mustard);
    background:var(--card); color:var(--body)}}
  .curves{{display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:.7rem; margin:0 0 1rem}}
  .curve{{background:var(--card); border:1px solid var(--line); padding:.7rem .8rem}}
  .curve svg{{display:block; width:100%; height:44px; margin-bottom:.45rem}}
  .curve b{{display:block; font-size:.85rem; color:var(--ink)}}
  .curve span{{font-size:.78rem; color:var(--muted); line-height:1.35; display:block}}
  .curve .cyc{{color:var(--mustard); font-weight:700}}
  .foot{{margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--line);
        color:var(--muted); font-size:.85rem}}
  @media (prefers-reduced-motion:reduce){{*{{animation:none!important}}}}
</style>
</head>
<body>
<div class="wrap">
  <div class="masthead">
    <div class="brand">tunefield<b>.</b> user manual</div>
    <div class="ver">version {version} · built {built}</div>
  </div>
  {body}
  <div class="foot">Generated from MANUAL.md · Tunefield {version}</div>
</div>
</body>
</html>
"""

html = TEMPLATE.format(version=version, built=date.today().isoformat(), body=body)
open(OUT, "w", encoding="utf-8").write(html)

# ── freshness checks ─────────────────────────────────────────────────────────
missing = []
for target in re.findall(r"\]\(#([^)]+)\)", md_text):
    if f'id="{target}"' not in html:
        missing.append(target)
size = os.path.getsize(OUT)
print(f"built static/manual.html — {size/1024:.0f} KB, version {version}")
if "<!-- curves:gallery -->" in md_text:
    print("curve gallery:", "expanded" if "tf-curves" in html else "MARKER NOT EXPANDED (!)")
if missing:
    print("BROKEN ANCHORS (Contents links with no target):", missing)
    sys.exit(1)
leftover = re.findall(r'href="[^"#][^"]*\.md"', html)
if leftover:
    print("RELATIVE .md LINKS would 404 at /manual:", leftover)
    sys.exit(1)
print("all Contents anchors resolve; no dead .md links")
