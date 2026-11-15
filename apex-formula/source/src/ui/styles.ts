/** All UI styling, injected once as a <style> element. System fonts only; sizes scale with the viewport. */
export const CSS = /* css */ `
.af{position:absolute;inset:0;overflow:hidden;pointer-events:none;color:#fff;
  font-family:"Helvetica Neue",Helvetica,"Segoe UI",Roboto,Arial,sans-serif;
  font-size:clamp(11px,.85vw,24px);line-height:1.25;
  --red:#e10600;--purple:#a020f0;--green:#25c65a;--yellow:#f7d117;--blue:#2f7cff;
  --panel:rgba(10,10,14,.82);--panel2:rgba(16,16,22,.92);--line:rgba(255,255,255,.12);--dim:rgba(255,255,255,.55);
  --row:clamp(18px,2.6vh,34px);
  -webkit-user-select:none;user-select:none;-webkit-font-smoothing:antialiased;}
.af *{box-sizing:border-box;margin:0;padding:0}
.af .hidden{display:none!important}
.af .af-dim{color:var(--dim)}
.af-ico{display:inline-flex;width:1.3em;height:1.3em;vertical-align:middle;flex:0 0 auto}
.af-ico svg{width:100%;height:100%}
.af-ico-inline{width:1.1em;height:1.1em;margin-right:.4em}
.af-swatch{display:inline-block;width:.8em;height:.8em;border-radius:50%;margin-right:.45em;vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,.6)}
.af-screen{position:absolute;inset:0;pointer-events:auto}
.af-key{display:inline-block;padding:.08em .5em;border:1px solid rgba(255,255,255,.35);border-radius:.18em;margin-right:.5em;font-weight:700;color:#fff;font-size:.85em;letter-spacing:.04em;min-width:1.6em;text-align:center;font-style:normal}
.af-hints{display:flex;flex-wrap:wrap;gap:1.4em;margin-top:auto;padding-top:1.4vh;color:var(--dim);font-size:.78em;letter-spacing:.08em;text-transform:uppercase}
.af-hint{white-space:nowrap}
.af-tag{display:inline-flex;align-items:center;padding:.3em .7em;background:rgba(255,255,255,.08);border:1px solid var(--line);font-size:.8em;font-weight:700;letter-spacing:.06em;margin:.2em .3em .2em 0}

/* ─── buttons ─── */
.af-btn{position:relative;z-index:0;display:inline-flex;align-items:center;justify-content:center;padding:.75em 2.4em;margin:.22em 0;
  font-weight:800;font-style:italic;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;color:#fff;transition:transform .15s}
.af-btn::before{content:'';position:absolute;inset:0;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);transform:skewX(-12deg);z-index:-1;transition:background .15s,border-color .15s,box-shadow .15s}
.af-btn.focus{transform:translateX(.3em)}
.af-btn.focus::before{background:var(--red);border-color:var(--red);box-shadow:0 .4em 1.6em rgba(225,6,0,.45)}
.af-btn-primary::before{background:var(--red);border-color:var(--red)}
.af-btn-primary.focus::before{background:#ff2b1f;box-shadow:0 .4em 2em rgba(255,43,31,.6)}
.af-btn-ghost::before{background:transparent}
.af-btn-danger.focus::before{background:#8a0a0a;border-color:#c81616}
.af-btn-big{font-size:1.5em;padding:.8em 3.2em}
.af-btn-chip{padding:.45em 1.2em;font-size:.85em;margin:0 .25em}
.af-btn-chip.on::before{background:rgba(255,255,255,.22);border-color:#fff}
.af-btn-exit{margin-left:auto}

/* ─── option rows ─── */
.af-rows{display:flex;flex-direction:column;gap:.18em}
.af-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"label right" "hint right";align-items:center;column-gap:.8em;
  padding:.5em 1em .5em 1.1em;background:var(--panel);border-left:.24em solid transparent;cursor:pointer;position:relative;transition:background .12s,border-color .12s}
.af-row.focus{background:rgba(255,255,255,.1);border-left-color:var(--red)}
.af-row.disabled{opacity:.35;pointer-events:none}
.af-row-label{grid-area:label;font-weight:800;letter-spacing:.06em;font-size:.88em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-row-hint{grid-area:hint;color:var(--dim);font-size:.7em;min-height:1.15em;line-height:1.15;margin-top:.15em;opacity:0;transition:opacity .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-row.focus .af-row-hint{opacity:1}
.af-row-right{grid-area:right;display:flex;align-items:center;gap:.9em}
.af-bar{width:7em;height:.42em;background:rgba(255,255,255,.12);position:relative;overflow:hidden}
.af-bar-fill{position:absolute;inset:0;background:var(--red);transform-origin:left center;transition:transform .1s}
.af-row-value{display:flex;align-items:center;gap:.45em;min-width:7.5em;white-space:nowrap;justify-content:flex-end;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.af-arrow{color:rgba(255,255,255,.25);cursor:pointer;padding:0 .2em;transition:color .12s}
.af-row.focus .af-arrow{color:#fff}
.af-arrow:hover{color:var(--red)}
.af-row-chev{grid-area:right;font-size:1.4em;color:var(--dim);font-weight:300}
.af-row.focus .af-row-chev{color:#fff}
.af-row-link .af-row-label{color:#fff}

/* ─── section header ─── */
.af-sec{display:flex;align-items:baseline;gap:.9em;margin-bottom:1.6vh}
.af-sec-idx{background:var(--red);padding:.12em .65em;font-weight:900;font-style:italic;transform:skewX(-12deg);letter-spacing:.06em;font-size:.95em}
.af-sec-title{font-size:2em;font-weight:900;font-style:italic;letter-spacing:-.025em;text-transform:uppercase;line-height:1}
.af-sec-sub{color:var(--dim);font-size:.82em;margin-left:auto;letter-spacing:.04em;text-align:right}

/* ═══════════════════════════ TITLE ═══════════════════════════ */
.af-title{background:radial-gradient(120% 90% at 30% 40%,rgba(40,8,10,.55),transparent 60%),linear-gradient(180deg,rgba(6,6,10,.35),rgba(6,6,10,.9));cursor:pointer}
.af-title-bg{position:absolute;inset:0;background:linear-gradient(115deg,rgba(0,0,0,.65) 0%,rgba(0,0,0,.15) 45%,rgba(0,0,0,.7) 100%)}
.af-title-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:6vw 6vw;mask-image:radial-gradient(60% 60% at 50% 50%,#000,transparent);-webkit-mask-image:radial-gradient(60% 60% at 50% 50%,#000,transparent)}
.af-streaks{position:absolute;inset:0;overflow:hidden}
.af-streak{position:absolute;left:-45vw;top:calc(22% + var(--i)*8.5%);width:42vw;height:2px;background:linear-gradient(90deg,transparent,var(--red) 40%,#fff 55%,transparent);opacity:.75;transform:skewX(-35deg);
  animation:af-streak 3.4s cubic-bezier(.3,.6,.4,1) infinite;animation-delay:calc(var(--i)*-.55s)}
@keyframes af-streak{0%{transform:translateX(0) skewX(-35deg);opacity:0}8%{opacity:.9}60%{opacity:.6}100%{transform:translateX(200vw) skewX(-35deg);opacity:0}}
.af-title-centre{position:absolute;left:8vw;top:50%;transform:translateY(-52%);display:flex;flex-direction:column;align-items:flex-start}
.af-title-kicker{font-size:.95em;letter-spacing:.42em;color:var(--dim);margin-bottom:1.6vh;opacity:0;animation:af-fade .6s .2s forwards}
.af-wordmark{display:flex;flex-direction:column;line-height:.86;transform:skewX(-6deg)}
.af-word{font-size:clamp(56px,10.5vw,240px);font-weight:900;font-style:italic;letter-spacing:-.045em;text-transform:uppercase;white-space:nowrap}
.af-word2{color:var(--red);text-shadow:0 0 3vw rgba(225,6,0,.35)}
.af-letter{display:inline-block;opacity:0;transform:translateX(-.35em) skewX(-20deg);filter:blur(8px);animation:af-letter .55s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d)}
.af-title.skip .af-letter,.af-title.skip .af-title-kicker,.af-title.skip .af-title-rule,.af-title.skip .af-tagline,.af-title.skip .af-press{animation-duration:0s;animation-delay:0s}
@keyframes af-letter{to{opacity:1;transform:none;filter:none}}
.af-title-rule{width:32vw;height:3px;margin:2.6vh 0 1.8vh;background:linear-gradient(90deg,var(--red),rgba(225,6,0,0));transform:scaleX(0);transform-origin:left;animation:af-grow .7s .8s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes af-grow{to{transform:scaleX(1)}}
.af-tagline{font-size:1.15em;letter-spacing:.32em;font-weight:600;color:rgba(255,255,255,.85);opacity:0;animation:af-fade .6s 1.1s forwards}
.af-press{margin-top:6vh;display:flex;align-items:center;gap:.7em;font-weight:800;letter-spacing:.24em;font-size:1em;opacity:0;animation:af-fade .5s 1.5s forwards,af-pulse 1.6s 1.9s ease-in-out infinite}
.af-press-glyph{display:inline-block;padding:.15em .8em;border:2px solid #fff;font-style:normal;letter-spacing:.12em}
@keyframes af-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes af-fade{to{opacity:1}}
.af-title-foot{position:absolute;left:8vw;right:8vw;bottom:4vh;display:flex;justify-content:space-between;font-size:.72em;letter-spacing:.2em;color:rgba(255,255,255,.5);opacity:0;animation:af-fade .6s 1.4s forwards}

/* ═══════════════════════════ MENU ═══════════════════════════ */
.af-menu-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,4,8,.94) 0%,rgba(4,4,8,.9) 36%,rgba(4,4,8,.45) 50%,rgba(4,4,8,0) 64%);pointer-events:none}
.af-menu-panel{position:absolute;left:0;top:0;bottom:0;width:47vw;padding:3.5vh 2vw 3vh 3.2vw;display:flex;flex-direction:column;opacity:0;transform:translateX(-2vw)}
.af-menu.on .af-menu-panel{animation:af-slidein .38s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes af-slidein{to{opacity:1;transform:none}}
.af-menu-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3.2vh;padding-bottom:1.2vh;border-bottom:1px solid var(--line)}
.af-brand{font-weight:900;font-style:italic;font-size:1.55em;letter-spacing:-.035em}
.af-brand-b{color:var(--red);margin-left:.28em}
.af-crumbs{display:flex;gap:.7em;color:var(--dim);font-size:.75em;letter-spacing:.14em;font-weight:600}
.af-crumb.on{color:#fff}
.af-crumb::after{content:'›';margin-left:.7em;color:var(--dim)}
.af-crumb:last-child::after{content:''}
.af-view{flex:1;display:flex;flex-direction:column;min-height:0}
.af-view.in{animation:af-viewin .3s cubic-bezier(.2,.8,.2,1)}
@keyframes af-viewin{from{opacity:0;transform:translateX(1.4vw)}to{opacity:1;transform:none}}

/* main list */
.af-mainlist{display:flex;flex-direction:column;gap:.45em;margin-top:2vh}
.af-mainitem{display:flex;align-items:center;gap:1.1em;padding:1em 1.6em 1em 1.4em;position:relative;z-index:0;cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1);max-width:40vw}
.af-mainitem::before{content:'';position:absolute;inset:0;background:var(--panel);border-left:.3em solid rgba(255,255,255,.12);transform:skewX(-12deg);z-index:-1;transition:background .15s,border-color .15s}
.af-mainitem.focus{transform:translateX(1.2em)}
.af-mainitem.focus::before{background:rgba(255,255,255,.09);border-left-color:var(--red);box-shadow:0 .6em 2em rgba(0,0,0,.4)}
.af-mainitem-idx{font-size:.8em;color:var(--dim);font-weight:700;letter-spacing:.1em;font-variant-numeric:tabular-nums}
.af-mainitem.focus .af-mainitem-idx{color:var(--red)}
.af-mainitem-text{display:flex;flex-direction:column;gap:.15em}
.af-mainitem-label{font-size:1.75em;font-weight:900;font-style:italic;letter-spacing:-.02em;line-height:1}
.af-mainitem-minor .af-mainitem-label{font-size:1.2em}
.af-mainitem-minor{padding-top:.7em;padding-bottom:.7em}
.af-mainitem-sub{font-size:.78em;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}
.af-mainitem-chev{margin-left:auto;font-size:1.6em;color:var(--dim);font-weight:300}
.af-mainitem.focus .af-mainitem-chev{color:#fff}
.af-maininfo{margin-top:3vh;padding:1.2em 1.4em;border-left:2px solid var(--red);max-width:34vw}
.af-maininfo-title{font-weight:900;font-style:italic;letter-spacing:.06em;margin-bottom:.4em}
.af-maininfo-desc{color:rgba(255,255,255,.75);font-size:.92em;line-height:1.4}

/* drivers */
.af-dgrid{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr;gap:.45vw;flex:1;min-height:0}
.af-dcard{position:relative;background:var(--panel);border-left:.28vw solid var(--team);padding:.45vw .6vw .5vw;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;overflow:hidden;
  transition:transform .15s,background .15s,box-shadow .15s;min-height:0}
.af-dcard::after{content:'';position:absolute;right:0;top:0;width:1.8vw;height:.28vw;background:var(--team2)}
.af-dcard.focus{background:rgba(255,255,255,.12);transform:translateY(-.25vh);box-shadow:0 0 0 1px rgba(255,255,255,.5),0 .6vh 2vh rgba(0,0,0,.5)}
.af-dcard-top{display:flex;justify-content:space-between;align-items:baseline}
.af-dcard-num{font-size:1.55em;font-weight:900;font-style:italic;line-height:1;letter-spacing:-.04em}
.af-dcard-code{font-size:.72em;font-weight:800;letter-spacing:.12em;color:var(--dim)}
.af-dcard.focus .af-dcard-code{color:#fff}
.af-dcard-name{display:flex;flex-direction:column;line-height:1;margin:.2em 0}
.af-dcard-first{font-size:.68em;color:rgba(255,255,255,.7);letter-spacing:.02em}
.af-dcard-last{font-size:.95em;font-weight:900;text-transform:uppercase;letter-spacing:-.01em}
.af-dcard-meta{display:flex;align-items:center;gap:.5em;font-size:.66em;font-weight:700;letter-spacing:.08em;color:var(--dim)}
.af-helmet{display:inline-flex;gap:.15em;margin-left:auto}
.af-helmet-c{width:.75em;height:.75em;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.6)}
.af-skills{display:flex;gap:.3em;margin-top:.35em}
.af-skill{flex:1;height:.28em;background:rgba(255,255,255,.12);position:relative;overflow:hidden}
.af-skill-fill{position:absolute;inset:0;background:rgba(255,255,255,.7);transform-origin:left}
.af-dcard.focus .af-skill-fill{background:var(--red)}
.af-ddetail{margin-top:1.2vh;padding:1vh 1.2vw 1.1vh;background:var(--panel);border-left:.3vw solid var(--red);display:grid;grid-template-columns:1fr 1fr;grid-template-areas:"name meta" "team meta" "bio meta";column-gap:1.6vw;row-gap:.2vh;min-height:13vh}
.af-ddetail-name{grid-area:name;font-size:1.9em;font-weight:900;font-style:italic;letter-spacing:-.03em;line-height:1;position:relative;padding-left:.4em}
.af-ddetail-name::before{content:'';position:absolute;left:0;top:.1em;bottom:.05em;width:.14em;background:var(--team,var(--red))}
.af-ddetail-team{grid-area:team;font-size:.72em;letter-spacing:.14em;color:var(--dim);font-weight:700;margin-top:.5em}
.af-ddetail-bio{grid-area:bio;font-size:.9em;color:rgba(255,255,255,.8);line-height:1.35;margin-top:.6em;align-self:end}
.af-ddetail-meta{grid-area:meta;display:flex;flex-direction:column;gap:.3em;justify-content:center}
.af-ddetail-skill{display:grid;grid-template-columns:8.2em minmax(0,1fr) 2em;align-items:center;gap:.6em;font-size:.72em;letter-spacing:.1em;font-weight:700}
.af-ddetail-k{color:var(--dim)}
.af-ddetail-bar{height:.4em;background:rgba(255,255,255,.12);position:relative;overflow:hidden}
.af-ddetail-fill{position:absolute;inset:0;background:linear-gradient(90deg,var(--red),#ff6a5a);transform-origin:left}
.af-ddetail-v{text-align:right;font-variant-numeric:tabular-nums}
.af-ddetail-nat{font-size:.7em;color:var(--dim);letter-spacing:.14em;margin-top:.3em;font-weight:700}

/* circuits */
.af-cwrap{display:flex;gap:1vw;flex:1;min-height:0}
.af-clist{width:16vw;display:flex;flex-direction:column;gap:.3vh;flex:0 0 auto;overflow:hidden}
.af-crow{display:flex;align-items:center;gap:.7em;padding:.7em .9em;background:var(--panel);border-left:.24em solid transparent;cursor:pointer;transition:background .12s,border-color .12s}
.af-crow.focus{background:rgba(255,255,255,.1);border-left-color:var(--red)}
.af-crow-idx{font-size:.75em;color:var(--dim);font-weight:700;font-variant-numeric:tabular-nums}
.af-crow.focus .af-crow-idx{color:var(--red)}
.af-crow-text{display:flex;flex-direction:column;gap:.1em;min-width:0}
.af-crow-name{font-weight:900;font-style:italic;font-size:.88em;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-crow-sub{font-size:.68em;color:var(--dim);letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-crow-ico{margin-left:auto;color:var(--dim)}
.af-cdetail{flex:1;min-width:0;background:var(--panel);padding:1.2vh 1.2vw;display:flex;flex-direction:column;border-top:2px solid var(--red)}
.af-cdetail-head{display:flex;flex-direction:column;gap:.1em}
.af-cdetail-gp{font-size:.7em;letter-spacing:.2em;color:var(--red);font-weight:800}
.af-cdetail-name{font-size:1.9em;font-weight:900;font-style:italic;letter-spacing:-.03em;line-height:1}
.af-cdetail-loc{font-size:.78em;color:var(--dim);letter-spacing:.08em}
.af-cdetail-map{flex:1;min-height:0;position:relative;margin:1vh 0}
.af-cdetail-map .af-trackmap{position:absolute;inset:0;width:100%;height:100%}
.af-cdetail-legend{position:absolute;left:0;bottom:0;display:flex;gap:.6em;font-size:.62em;font-weight:800;letter-spacing:.1em}
.af-leg{padding:.15em .5em;border-left:.3em solid #888;background:rgba(0,0,0,.4)}
.af-leg-s1{border-color:#ff4b4b}.af-leg-s2{border-color:#4aa8ff}.af-leg-s3{border-color:#f7d117}.af-leg-drs{border-color:#25c65a}.af-leg-pit{border-color:rgba(255,255,255,.6)}
.af-cstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4em;margin-bottom:.9vh}
.af-cstat{background:rgba(255,255,255,.05);padding:.4em .6em;border-top:1px solid var(--line);min-width:0}
.af-cstat-v{font-weight:900;font-style:italic;font-size:.95em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;display:flex;align-items:center;gap:.3em;letter-spacing:-.01em}
.af-cstat-k{font-size:.6em;color:var(--dim);letter-spacing:.14em;margin-top:.15em}
.af-cdetail-desc{font-size:.9em;color:rgba(255,255,255,.85);line-height:1.35}
.af-cdetail-vibe{font-size:.72em;color:var(--dim);margin-top:.4em;font-style:italic}

/* session setup */
.af-scols{display:flex;gap:1vw;flex:1;min-height:0}
.af-session-rows{flex:1.7;min-width:0;overflow:hidden}
.af-ssummary{flex:1;background:var(--panel);border-top:2px solid var(--red);padding:1.2vh 1.1vw;display:flex;flex-direction:column;gap:.5vh;min-width:0}
.af-ssum-mode{font-size:.7em;letter-spacing:.2em;color:var(--red);font-weight:800}
.af-ssum-driver{display:flex;align-items:center;gap:.7em;border-left:.3em solid var(--team);padding-left:.7em}
.af-ssum-num{font-size:2.2em;font-weight:900;font-style:italic;line-height:1;letter-spacing:-.05em}
.af-ssum-dname{font-weight:900;font-style:italic;font-size:1.1em;letter-spacing:-.01em}
.af-ssum-dteam{font-size:.68em;color:var(--dim);letter-spacing:.12em}
.af-ssum-map{flex:1;min-height:8vh;position:relative}
.af-ssum-map .af-trackmap{position:absolute;inset:0;width:100%;height:100%}
.af-ssum-circuit{font-size:1.25em;font-weight:900;font-style:italic;letter-spacing:-.02em;line-height:1}
.af-ssum-gp{font-size:.72em;color:var(--dim);letter-spacing:.1em}
.af-ssum-tags{display:flex;flex-wrap:wrap;margin-top:.3vh}
.af-ssum-note{font-size:.7em;letter-spacing:.12em;color:var(--yellow);font-weight:800;margin-top:.4vh}
.af-session-foot,.af-settings-foot{display:flex;justify-content:flex-end;margin-top:1.4vh}
.af-btn-start{font-size:1.25em;padding:.8em 3.4em}

/* settings */
.af-settings{display:flex;flex-direction:column;flex:1;min-height:0}
.af-settings-main,.af-settings-assists{display:flex;flex-direction:column;flex:1;min-height:0}
.af-settings .af-rows{overflow:hidden}

/* controls */
.af-ctrlcols{display:flex;gap:1.2vw;flex:1;min-height:0}
.af-ctrltable{flex:1;background:var(--panel);padding:1vh 1vw;display:flex;flex-direction:column;gap:.15em;overflow:hidden;min-width:0}
.af-ctrltable-title{font-weight:900;font-style:italic;letter-spacing:.1em;color:var(--red);margin-bottom:.4em;font-size:.9em}
.af-ctrlrow{display:flex;align-items:center;gap:.8em;font-size:.72em;padding:.18em 0;border-bottom:1px solid rgba(255,255,255,.05)}
.af-ctrlkeys{display:flex;gap:.2em;flex:0 0 11em}
.af-ctrlkeys .af-key{margin-right:0;font-size:.9em}
.af-ctrlact{color:rgba(255,255,255,.85);letter-spacing:.04em}

/* ═══════════════════════════ TRACK MAP (svg) ═══════════════════════════ */
.af-trackmap{display:block;overflow:visible}
.af-tm-glow{stroke:rgba(0,0,0,.6)}
.af-tm-base{stroke:#15151b}
.af-tm-line{stroke:#fff}
.af-tm-drs{stroke:rgba(37,198,90,.3)}
.af-tm-drsdet{fill:#25c65a;opacity:.9}
.af-tm-pit{stroke:rgba(255,255,255,.55)}
.af-tm-sf{stroke:#fff}
.af-tm-corner{fill:rgba(255,255,255,.8);font-weight:800;font-family:inherit}
.af-tm-draw{stroke-dasharray:1000;stroke-dashoffset:1000;animation:af-draw 2.2s cubic-bezier(.4,.1,.2,1) forwards}
.af-tm-s1.af-tm-draw{animation-delay:.6s}.af-tm-s2.af-tm-draw{animation-delay:1.2s}
@keyframes af-draw{to{stroke-dashoffset:0}}
.af-mm-dot{stroke:rgba(0,0,0,.7);stroke-width:2;transition:opacity .3s}
.af-mm-dot.player{stroke:#fff;stroke-width:3}
.af-mm-dot.out{opacity:.25}
.af-mm-ring{fill:none;stroke:#fff;stroke-width:3;opacity:.85;animation:af-ring 1.4s ease-in-out infinite}
@keyframes af-ring{0%,100%{opacity:.85}50%{opacity:.3}}

/* ═══════════════════════════ LOADING ═══════════════════════════ */
.af-loading{background:#07070b}
.af-loading-bg{position:absolute;inset:0;background:radial-gradient(90% 70% at 70% 50%,rgba(225,6,0,.12),transparent 60%),linear-gradient(180deg,#0a0a10,#050507);}
.af-loading-bg::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:5vw 5vw}
.af-loading-inner{position:absolute;inset:9vh 6vw 10vh;display:flex;gap:4vw;align-items:stretch}
.af-loading-left{width:34vw;display:flex;flex-direction:column;justify-content:center;opacity:0;transform:translateY(2vh)}
.af-loading.on .af-loading-left{animation:af-slidein .5s .1s cubic-bezier(.2,.8,.2,1) forwards}
.af-loading-kicker{font-size:.8em;letter-spacing:.36em;color:var(--red);font-weight:800}
.af-loading-title{font-size:4.2em;font-weight:900;font-style:italic;letter-spacing:-.04em;line-height:.95;margin-top:.3em}
.af-loading-gp{font-size:1.1em;letter-spacing:.2em;font-weight:700;margin-top:.6em;color:rgba(255,255,255,.85)}
.af-loading-loc{font-size:.85em;color:var(--dim);letter-spacing:.1em;margin-top:.3em}
.af-loading-facts{display:flex;gap:1.6em;margin:3.5vh 0 3vh;padding-top:1.5vh;border-top:1px solid var(--line)}
.af-lfact-v{font-size:1.5em;font-weight:900;font-style:italic;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.af-lfact-k{font-size:.62em;color:var(--dim);letter-spacing:.16em;margin-top:.2em}
.af-loading-bar{height:.55em;background:rgba(255,255,255,.1);position:relative;overflow:hidden;transform:skewX(-20deg)}
.af-loading-fill{position:absolute;inset:0;background:linear-gradient(90deg,var(--red),#ff5f52);transform-origin:left;transition:transform .25s ease-out}
.af-loading-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);animation:af-sheen 1.4s linear infinite;transform:translateX(-100%)}
@keyframes af-sheen{to{transform:translateX(100%)}}
.af-loading-meta{display:flex;justify-content:space-between;margin-top:.8em;font-size:.78em;letter-spacing:.14em;font-weight:700}
.af-loading-pct{font-variant-numeric:tabular-nums;color:var(--red)}
.af-loading-tip{margin-top:4vh;font-size:.95em;color:rgba(255,255,255,.75);line-height:1.45;min-height:3em;border-left:2px solid var(--red);padding-left:1em}
.af-loading-tip.in{animation:af-fadeup .5s cubic-bezier(.2,.8,.2,1)}
@keyframes af-fadeup{from{opacity:0;transform:translateY(.6em)}to{opacity:1;transform:none}}
.af-loading-map{flex:1;position:relative;min-width:0;opacity:0}
.af-loading.on .af-loading-map{animation:af-fade .8s .3s forwards}
.af-loading-map .af-trackmap{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 0 1.5vw rgba(255,255,255,.08))}
.af-loading-foot{position:absolute;left:6vw;bottom:4vh;font-size:.68em;letter-spacing:.3em;color:rgba(255,255,255,.4)}

/* ═══════════════════════════ GRID (pre-session) ═══════════════════════════ */
.af-grid-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,4,8,.88) 0%,rgba(4,4,8,.7) 38%,rgba(4,4,8,0) 60%);pointer-events:none}
.af-grid-panel{position:absolute;left:3vw;top:4vh;bottom:15vh;width:40vw;display:flex;flex-direction:column;opacity:0;transform:translateX(-2vw)}
.af-grid.on .af-grid-panel{animation:af-slidein .4s cubic-bezier(.2,.8,.2,1) forwards}
.af-grid-kicker{font-size:.8em;letter-spacing:.34em;color:var(--red);font-weight:800}
.af-grid-title{font-size:2.6em;font-weight:900;font-style:italic;letter-spacing:-.035em;line-height:1;margin:.2em 0 1.2vh}
.af-grid-summary{display:flex;gap:.5em;flex-wrap:wrap;margin-bottom:1.4vh}
.af-gchip{display:flex;align-items:center;gap:.5em;background:var(--panel);padding:.5em .9em;border-top:2px solid rgba(255,255,255,.2)}
.af-gchip-v{font-weight:900;font-style:italic;font-size:.95em;white-space:nowrap}
.af-gchip-k{font-size:.6em;color:var(--dim);letter-spacing:.14em}
.af-grid-list{flex:1;min-height:0;display:grid;grid-template-rows:repeat(10,1fr);grid-auto-flow:column;grid-template-columns:1fr 1fr;gap:.25em .8em}
.af-grow{display:flex;align-items:center;gap:.5em;background:var(--panel);padding:0 .7em;font-size:.85em;border-left:.25em solid var(--team);min-height:0}
.af-grow.player{background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.af-grow-pos{font-weight:900;font-style:italic;width:1.6em;font-variant-numeric:tabular-nums;font-size:1.15em}
.af-grow-bar{display:none}
.af-grow-code{font-weight:800;letter-spacing:.08em;width:2.8em}
.af-grow-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.85);font-size:.92em}
.af-grow-team{font-size:.7em;color:var(--dim);letter-spacing:.08em;font-weight:700}
.af-tyre{display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:50%;border:.18em solid var(--tyre,#ccc);font-size:.75em;font-weight:900;background:#111;flex:0 0 auto}
.af-grid-foot{position:absolute;left:50%;bottom:4vh;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:1vh}
.af-grid-foot .af-hints{margin-top:0;padding-top:0;justify-content:center}
.af-esc{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
.af-esc-box{background:var(--panel2);padding:2.4vh 2.4vw;display:flex;flex-direction:column;gap:.3em;min-width:22vw;border-top:3px solid var(--red)}
.af-esc-title{font-size:1.8em;font-weight:900;font-style:italic;letter-spacing:-.02em;margin-bottom:1vh}

/* ═══════════════════════════ PAUSE ═══════════════════════════ */
.af-pause-shade{position:absolute;inset:0;background:radial-gradient(70% 70% at 50% 50%,rgba(0,0,0,.55),rgba(0,0,0,.8));pointer-events:none}
.af-pause-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:40vw;max-height:88vh;display:flex;flex-direction:column;opacity:0}
.af-pause.on .af-pause-panel{animation:af-popin .28s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes af-popin{from{opacity:0;transform:translate(-50%,-48%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.af-pause-menu,.af-pause-settings{display:flex;flex-direction:column;background:var(--panel2);padding:2.4vh 2.2vw 2vh;border-top:3px solid var(--red);min-height:0}
.af-pause-head{margin-bottom:1.6vh}
.af-pause-title{font-size:2.6em;font-weight:900;font-style:italic;letter-spacing:-.035em;line-height:1}
.af-pause-sub{font-size:.75em;letter-spacing:.16em;color:var(--dim);font-weight:700;margin-top:.5em}
.af-pause-list{display:flex;flex-direction:column;gap:.1em}
.af-pause-list .af-btn{justify-content:flex-start;padding-left:1.6em}
.af-pause-settings .af-rows{overflow:auto;max-height:52vh}

/* ═══════════════════════════ REPLAY ═══════════════════════════ */
.af-replay{pointer-events:none}
.af-replay-tag{position:absolute;left:2vw;top:3vh;display:flex;align-items:center;gap:1em;padding:.5em 1.4em;background:var(--red);font-weight:900;font-style:italic;letter-spacing:.2em;font-size:1.2em;transform:skewX(-12deg);box-shadow:0 .5em 2em rgba(225,6,0,.4)}
.af-replay-tag > *{transform:skewX(12deg)}
.af-replay-bars{display:inline-flex;gap:.18em;align-items:flex-end;height:1em}
.af-replay-bar{width:.22em;background:#fff;height:100%;animation:af-eq .9s ease-in-out infinite;transform-origin:bottom}
.af-replay-bar:nth-child(2){animation-delay:-.2s}.af-replay-bar:nth-child(3){animation-delay:-.4s}.af-replay-bar:nth-child(4){animation-delay:-.6s}.af-replay-bar:nth-child(5){animation-delay:-.8s}
@keyframes af-eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
.af-replay-cam{position:absolute;right:2vw;top:3.6vh;font-size:.72em;letter-spacing:.18em;color:var(--dim);font-weight:700;white-space:pre}
.af-replay-panel{position:absolute;left:22vw;right:22vw;bottom:4vh;background:var(--panel2);padding:1.6vh 1.6vw 1.2vh;border-top:2px solid var(--red);pointer-events:auto;opacity:0}
.af-replay.on .af-replay-panel{animation:af-fadeup .35s .05s cubic-bezier(.2,.8,.2,1) forwards}
.af-replay-panel .af-hints{margin-top:1vh;padding-top:0}
.af-replay-timeline{display:flex;align-items:center;gap:1em;padding:.4em .6em;border:1px solid transparent}
.af-replay-timeline.focus{border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.04)}
.af-replay-time{font-variant-numeric:tabular-nums;font-weight:800;font-size:.95em;min-width:3em}
.af-replay-end{text-align:right;color:var(--dim)}
.af-replay-track{flex:1;height:.6em;background:rgba(255,255,255,.12);position:relative;cursor:pointer}
.af-replay-fill{position:absolute;inset:0;background:var(--red);transform-origin:left}
.af-replay-head{position:absolute;top:50%;left:0;width:1em;height:1em;background:#fff;transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 0 .6em rgba(0,0,0,.6)}
.af-replay-controls{display:flex;align-items:center;margin-top:1vh}
.af-replay-speeds{display:flex}

/* ═══════════════════════════ RESULTS ═══════════════════════════ */
.af-results-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,4,8,.92) 0%,rgba(4,4,8,.85) 52%,rgba(4,4,8,.2) 72%,rgba(4,4,8,0) 90%);pointer-events:none}
.af-results-panel{position:absolute;left:2.5vw;top:3vh;bottom:3vh;width:62vw;display:flex;flex-direction:column;gap:1.1vh;opacity:0;transform:translateX(-2vw)}
.af-results.on .af-results-panel{animation:af-slidein .45s cubic-bezier(.2,.8,.2,1) forwards}
.af-results-kicker{font-size:.78em;letter-spacing:.32em;color:var(--red);font-weight:800}
.af-results-headline{font-size:3.2em;font-weight:900;font-style:italic;letter-spacing:-.04em;line-height:1;margin-top:.1em}
.af-results-headline.gold{color:#ffd54a;text-shadow:0 0 2vw rgba(255,213,74,.35)}
.af-results-headline.silver{color:#dfe6ee}
.af-results-headline.points{color:var(--green)}
.af-results-headline.bad{color:#ff5a5a}
.af-podium{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:.6em;align-items:end}
.af-podium-block{position:relative;background:var(--panel);border-top:.35em solid var(--team);padding:.9em 1em .8em;display:flex;flex-direction:column;gap:.15em;overflow:hidden;opacity:0;transform:translateY(1.5em)}
.af-results.on .af-podium-block{animation:af-fadeup .5s cubic-bezier(.2,.8,.2,1) forwards}
.af-results.on .af-podium-1{animation-delay:.35s}.af-results.on .af-podium-2{animation-delay:.5s}.af-results.on .af-podium-3{animation-delay:.65s}
.af-podium-block::after{content:'';position:absolute;right:-1.5em;top:-1.5em;width:5em;height:5em;background:var(--team2);opacity:.25;transform:rotate(25deg)}
.af-podium-1{min-height:13vh}.af-podium-2,.af-podium-3{min-height:10.5vh}
.af-podium-block.player{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5)}
.af-podium-top{display:flex;justify-content:space-between;align-items:baseline}
.af-podium-pos{font-size:2.6em;font-weight:900;font-style:italic;line-height:1;letter-spacing:-.05em}
.af-podium-1 .af-podium-pos{color:#ffd54a}
.af-podium-num{font-size:1.1em;font-weight:900;color:var(--dim)}
.af-podium-name{display:flex;flex-direction:column;line-height:1;margin-top:.3em}
.af-podium-first{font-size:.75em;color:rgba(255,255,255,.7)}
.af-podium-last{font-size:1.35em;font-weight:900;letter-spacing:-.02em}
.af-podium-team{font-size:.62em;letter-spacing:.14em;color:var(--dim);font-weight:700}
.af-podium-time{font-variant-numeric:tabular-nums;font-weight:800;margin-top:.3em;font-size:.95em}
.af-fl{display:flex;align-items:center;gap:1em;padding:.45em 1em;background:linear-gradient(90deg,rgba(160,32,240,.35),transparent);border-left:.35em solid var(--purple);font-size:.9em}
.af-fl-tag{font-weight:900;font-style:italic;letter-spacing:.14em;color:#d9a3ff}
.af-fl-name{font-weight:800}
.af-fl-time{font-variant-numeric:tabular-nums;font-weight:800;margin-left:auto}
.af-rtable{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:.12em;font-size:.86em;scrollbar-width:thin}
.af-rrow{display:grid;grid-template-columns:2.2em .3em 1.3fr 1fr 6.4em 6.2em 3.2em 3.6em 3em 3em;align-items:center;gap:.6em;padding:.34em .8em;background:var(--panel);font-variant-numeric:tabular-nums;white-space:nowrap}
/* Header keeps the row font-size so its em-based grid columns line up; shrink the labels instead. */
.af-rhead{background:transparent;color:var(--dim);padding-bottom:.1em}
.af-rhead > *{font-size:.7em;letter-spacing:.14em;font-weight:800;font-style:normal}
.af-rrow.player{background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.af-rrow.out{opacity:.5}
.af-rpos{font-weight:900;font-style:italic;font-size:1.1em}
.af-rbar{width:.3em;height:1.2em;background:var(--team)}
.af-rdriver{display:flex;gap:.6em;align-items:baseline;min-width:0;overflow:hidden}
.af-rcode{font-weight:900;letter-spacing:.06em}
.af-rname{color:rgba(255,255,255,.75);overflow:hidden;text-overflow:ellipsis;font-size:.92em}
.af-rteam{color:var(--dim);overflow:hidden;text-overflow:ellipsis;font-size:.88em}
.af-rtime{font-weight:800;text-align:right}
.af-rbest{text-align:right;color:rgba(255,255,255,.8)}
.af-rbest.purple{color:#d9a3ff;font-weight:900}
.af-rstops,.af-rpen,.af-rpts,.af-rchange{text-align:center}
.af-rpen.pen{color:#ff6a5a;font-weight:800}
.af-rpts.scored{font-weight:900;color:#fff}
.af-rchange.up{color:var(--green);font-weight:800}.af-rchange.down{color:#ff5a5a;font-weight:800}
.af-results-buttons{display:flex;gap:.8em;flex-wrap:wrap}
.af-results-panel .af-hints{margin-top:0;padding-top:0}

/* ═══════════════════════════ HUD ═══════════════════════════ */
.af-hud{position:absolute;inset:0;pointer-events:none}
.af-hud.paused > :not(.af-tower):not(.af-top){visibility:hidden}
.af-hud.replay > :not(.af-top){visibility:hidden}
.af-hud.minimal > :not(.af-top){visibility:hidden}
.af-hud.minimal .af-lapbox{visibility:hidden}
.af-hud.paused .af-tower{filter:none}

/* timing tower */
.af-tower{position:absolute;left:1.2vw;top:3.2vh;width:15.6em;font-size:clamp(10px,.8vw,21px);pointer-events:auto}
.af-tower-head{position:relative;z-index:0;display:flex;justify-content:space-between;align-items:center;padding:.35em 1em .35em .9em;margin-bottom:.35em;font-size:.78em;font-weight:800;letter-spacing:.16em}
.af-tower-head::before{content:'';position:absolute;inset:0;background:var(--red);transform:skewX(-12deg);z-index:-1}
.af-tower-mode{cursor:pointer;opacity:.85;padding:.1em .4em;border:1px solid rgba(255,255,255,.4)}
.af-tower-mode:hover{opacity:1;background:rgba(255,255,255,.15)}
.af-tower-list{position:relative;transition:height .3s}
.af-trow{position:absolute;left:0;right:0;top:0;height:var(--row);display:flex;align-items:center;gap:.35em;padding:0 .5em 0 .4em;background:var(--panel);border-bottom:1px solid rgba(255,255,255,.05);
  transition:transform .45s cubic-bezier(.2,.8,.2,1),background .3s;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
.af-trow.player{background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);z-index:1}
.af-trow.out{opacity:.45}
.af-trow.finished .af-tgap{color:#ffd54a}
.af-trow.blue{box-shadow:inset .3em 0 0 var(--blue)}
.af-trow.flash-up{animation:af-flashup 1.2s}
.af-trow.flash-down{animation:af-flashdown 1.2s}
@keyframes af-flashup{0%,40%{background:rgba(37,198,90,.55)}100%{background:var(--panel)}}
@keyframes af-flashdown{0%,40%{background:rgba(225,6,0,.55)}100%{background:var(--panel)}}
.af-tpos{width:1.7em;text-align:center;font-weight:900;font-style:italic;font-size:1.05em}
.af-tbar{width:.28em;height:68%;background:var(--team);flex:0 0 auto}
.af-tcode{width:2.9em;font-weight:800;letter-spacing:.06em;font-size:.95em}
.af-tgap{flex:1;text-align:right;font-weight:600;font-size:.88em;color:rgba(255,255,255,.9);letter-spacing:.02em}
.af-tfl{width:.55em;height:.55em;background:var(--purple);border-radius:1px;opacity:0;flex:0 0 auto}
.af-tfl.on{opacity:1;box-shadow:0 0 .5em var(--purple)}
.af-ttyre{display:inline-flex;align-items:center;justify-content:center;width:1.35em;height:1.35em;border-radius:50%;border:.16em solid var(--tyre,#ccc);font-size:.62em;font-weight:900;background:#111;flex:0 0 auto}
.af-tage{width:1.4em;font-size:.68em;color:var(--dim);text-align:left}
.af-ttag{min-width:2.9em;text-align:center;font-size:.6em;font-weight:900;letter-spacing:.08em;padding:.18em .3em;border-radius:1px;visibility:hidden}
.af-ttag.pit,.af-ttag.pit-req,.af-ttag.drs,.af-ttag.drs-open,.af-ttag.pen{visibility:visible}
.af-ttag.pit{background:#fff;color:#000}
.af-ttag.pit-req{border:1px solid rgba(255,255,255,.6)}
.af-ttag.drs{border:1px solid rgba(255,255,255,.7)}
.af-ttag.drs-open{background:var(--green);color:#03210d}
.af-ttag.pen{background:var(--red)}
.af-tarrow{width:1em;text-align:center;font-size:.7em;font-weight:900}
.af-tarrow.up{color:var(--green)}.af-tarrow.down{color:#ff5a5a}
.af-tower-divider{position:absolute;left:0;right:0;top:0;height:var(--row);display:flex;align-items:center;justify-content:center;color:var(--dim);letter-spacing:.4em;font-size:.7em;background:rgba(10,10,14,.5)}
.af-tower-divider::before{content:'· · ·'}

/* top centre */
.af-top{position:absolute;left:0;right:0;top:3.2vh;display:flex;flex-direction:column;align-items:center;gap:1.4vh}
.af-lapbox{position:relative;z-index:0;display:flex;align-items:baseline;gap:.6em;padding:.35em 1.5em .38em;font-size:clamp(12px,1.05vw,28px);font-weight:900;font-style:italic;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.af-lapbox::before{content:'';position:absolute;inset:0;background:var(--panel);border-top:2px solid var(--red);transform:skewX(-12deg);z-index:-1}
.af-lapbox-k{font-size:.62em;color:var(--dim);letter-spacing:.2em;font-style:normal;font-weight:800}
.af-lights{display:flex;gap:.6vw;padding:.9vw 1.1vw;background:rgba(4,4,6,.9);border:1px solid rgba(255,255,255,.1);border-radius:.3vw;margin-top:1vh;box-shadow:0 1vh 4vh rgba(0,0,0,.6)}
.af-light-col{display:flex;flex-direction:column;gap:.5vw}
.af-light{width:2.3vw;height:2.3vw;border-radius:50%;background:#2a0505;box-shadow:inset 0 .2vw .5vw rgba(0,0,0,.8);transition:background .08s,box-shadow .08s}
.af-light-col.on .af-light{background:#ff1a1a;box-shadow:0 0 1.4vw #ff2a2a,0 0 .3vw #fff inset}
.af-lights.go .af-light{background:#25c65a;box-shadow:0 0 1.6vw #25c65a}
.af-lights.go .af-light-col.on .af-light{background:#25c65a;box-shadow:0 0 1.6vw #25c65a}
.af-banner{position:absolute;left:21vw;right:21vw;top:11vh;height:6.2vh;clip-path:polygon(2.4vh 0,100% 0,calc(100% - 2.4vh) 100%,0 100%);display:flex;align-items:center;justify-content:center;gap:2vw;font-weight:900;font-style:italic;letter-spacing:.06em;font-size:clamp(14px,2.1vw,48px);text-transform:uppercase;transform-origin:center;box-shadow:0 .6vh 3vh rgba(0,0,0,.5)}
.af-banner.in{animation:af-bannerin .3s cubic-bezier(.2,.8,.2,1)}
@keyframes af-bannerin{from{transform:scaleY(0);opacity:0}to{transform:none;opacity:1}}
.af-banner-sub{font-size:.42em;font-style:normal;font-weight:800;letter-spacing:.24em;opacity:.85}
.af-banner.yellow{background:repeating-linear-gradient(-55deg,#f7d117 0 3vw,#e4bd00 3vw 6vw);color:#111;animation:af-bannerin .3s,af-blink 1s .3s steps(1) infinite}
@keyframes af-blink{50%{filter:brightness(.8)}}
.af-banner.red{background:#c40000;color:#fff}
.af-banner.blue{background:#2f7cff;color:#fff}
.af-banner.sc{background:#ff8c00;color:#111}
.af-banner.chequered{background:repeating-conic-gradient(#f2f2f2 0 25%,#111 0 50%) 0 0/3vh 3vh;color:#fff;text-shadow:0 0 .8vh #000,0 0 .2vh #000}
.af-banner.chequered .af-banner-text,.af-banner.chequered .af-banner-sub{background:rgba(0,0,0,.72);padding:.05em .6em}
.af-banner.bw{background:linear-gradient(90deg,#111 50%,#eee 50%);color:#fff;mix-blend-mode:normal}
.af-banner.bw .af-banner-text{background:rgba(0,0,0,.7);padding:.05em .6em}

/* right column */
.af-rightcol{position:absolute;right:1.2vw;top:3.2vh;width:17em;font-size:clamp(10px,.78vw,20px);display:flex;flex-direction:column;gap:.7vh}
.af-weather{background:var(--panel);padding:.55em .9em .6em;border-top:2px solid rgba(255,255,255,.25)}
.af-weather.wet{border-top-color:var(--blue)}
.af-weather-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.35em}
.af-weather-ico{display:inline-flex;width:1.6em;height:1.6em;color:#fff}
.af-weather-ico .af-ico{width:100%;height:100%}
.af-weather-clock{font-weight:900;font-style:italic;font-size:1.3em;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.af-weather-rows{display:grid;grid-template-columns:1fr 1fr;gap:.15em .8em}
.af-weather-row{display:flex;justify-content:space-between;font-size:.72em}
.af-weather-k{color:var(--dim);letter-spacing:.1em;font-weight:700}
.af-weather-v{font-weight:800;font-variant-numeric:tabular-nums}
.af-ticker{background:var(--panel);padding:.45em .9em .55em}
.af-ticker-head{font-size:.62em;letter-spacing:.24em;font-weight:900;color:var(--red);margin-bottom:.3em}
.af-ticker-row{display:flex;gap:.7em;font-size:.76em;padding:.22em 0;border-top:1px solid rgba(255,255,255,.06);line-height:1.25}
.af-ticker-row.in{animation:af-tickin .35s cubic-bezier(.2,.8,.2,1)}
@keyframes af-tickin{from{opacity:0;transform:translateX(1em)}to{opacity:1;transform:none}}
.af-ticker-row:nth-child(3){opacity:.75}.af-ticker-row:nth-child(4){opacity:.5}
.af-ticker-time{color:var(--dim);font-variant-numeric:tabular-nums;flex:0 0 2.6em;font-weight:700}
.af-ticker-text{flex:1;text-transform:uppercase;letter-spacing:.02em;font-weight:600}
.af-ticker-row[data-kind=penalty] .af-ticker-text{color:#ff6a5a}
.af-ticker-row[data-kind=flag] .af-ticker-text{color:var(--yellow)}
.af-ticker-row[data-kind=drs] .af-ticker-text{color:var(--green)}
.af-ticker-row[data-kind=warning] .af-ticker-text{color:#ffb14a}
.af-toasts,.af-gtoasts{display:flex;flex-direction:column;gap:.4em}
.af-gtoasts{position:absolute;right:1.2vw;top:3.2vh;width:20em;font-size:clamp(10px,.78vw,20px)}
.af-toast{display:flex;align-items:center;gap:.6em;padding:.55em .9em;background:var(--panel2);border-left:.3em solid rgba(255,255,255,.6);font-size:.8em;font-weight:800;letter-spacing:.06em;text-transform:uppercase;animation:af-tickin .3s cubic-bezier(.2,.8,.2,1);box-shadow:0 .4em 1.6em rgba(0,0,0,.45)}
.af-toast.out{animation:af-tickout .3s forwards}
@keyframes af-tickout{to{opacity:0;transform:translateX(1.4em)}}
.af-toast-penalty{border-left-color:var(--red);color:#ffb3ad}
.af-toast-warning{border-left-color:#ffb14a;color:#ffd39b}
.af-toast-pit{border-left-color:#fff}
.af-toast-flag{border-left-color:var(--yellow)}
.af-toast-drs{border-left-color:var(--green)}
.af-toast-radio{border-left-color:var(--blue)}
.af-toast-ico{width:1.2em;height:1.2em}

/* popups (centre) */
.af-popup{position:absolute;left:50%;top:27vh;transform:translateX(-50%);z-index:0;display:flex;flex-direction:column;align-items:center;padding:.5em 2.4em .6em;font-size:clamp(14px,1.7vw,40px);text-align:center;opacity:0}
.af-popup::before{content:'';position:absolute;inset:0;background:var(--panel2);border-left:.35em solid #fff;transform:skewX(-12deg);z-index:-1;box-shadow:0 .6em 2.5em rgba(0,0,0,.5)}
.af-popup.in{animation:af-popupin .32s cubic-bezier(.2,.9,.2,1) forwards}
.af-popup.out{animation:af-popupout .26s forwards}
@keyframes af-popupin{from{opacity:0;transform:translateX(-50%) translateY(-.4em) scale(.92)}to{opacity:1;transform:translateX(-50%)}}
@keyframes af-popupout{from{opacity:1}to{opacity:0;transform:translateX(-50%) translateY(.3em)}}
.af-popup-text{font-weight:900;font-style:italic;letter-spacing:-.01em;line-height:1}
.af-popup-sub{font-size:.42em;letter-spacing:.24em;font-weight:800;color:rgba(255,255,255,.85);margin-top:.35em;font-variant-numeric:tabular-nums}
.af-popup-sub:empty{display:none}
.af-popup.small{font-size:clamp(12px,1.1vw,26px);top:22vh}
.af-popup.purple::before{border-left-color:var(--purple);background:linear-gradient(90deg,rgba(160,32,240,.55),var(--panel2))}
.af-popup.purple .af-popup-text{color:#e4c2ff}
.af-popup.green::before{border-left-color:var(--green)}
.af-popup.green .af-popup-text{color:#8af0a8}
.af-popup.good::before{border-left-color:var(--green)}
.af-popup.bad::before{border-left-color:var(--red)}
.af-popup.bad .af-popup-text{color:#ff8a80}
.af-popup.penalty::before{border-left-color:var(--red);background:linear-gradient(90deg,rgba(225,6,0,.5),var(--panel2))}
.af-popup.drs::before{border-left-color:var(--green)}
.af-popup.drs .af-popup-text{color:var(--green)}
.af-popup.final::before{border-left-color:var(--yellow)}
.af-popup.final .af-popup-text{color:var(--yellow)}
.af-popup.pit::before{border-left-color:#fff}
.af-popup.radio::before{border-left-color:var(--blue)}

/* radio */
.af-radio{position:absolute;left:32vw;right:32vw;bottom:13vh;display:flex;align-items:center;gap:1vw;background:var(--panel2);border-left:.35vw solid var(--red);padding:1vh 1.2vw;font-size:clamp(11px,.9vw,24px);box-shadow:0 .8vh 3vh rgba(0,0,0,.5);opacity:0}
.af-radio.in{animation:af-fadeup .3s cubic-bezier(.2,.8,.2,1) forwards}
.af-radio.out{animation:af-fadedown .3s forwards}
@keyframes af-fadedown{from{opacity:1}to{opacity:0;transform:translateY(.4em)}}
.af-radio-ico{width:1.8em;height:1.8em;color:var(--red)}
.af-wave{display:inline-flex;gap:.16em;align-items:center;height:1.6em;flex:0 0 auto}
.af-wave-bar{width:.2em;height:100%;background:rgba(255,255,255,.85);animation:af-eq .8s ease-in-out infinite;animation-delay:calc(var(--i)*-.11s);transform-origin:center}
.af-radio-body{display:flex;flex-direction:column;gap:.2em;min-width:0}
.af-radio-from{display:flex;gap:.7em;font-size:.68em;letter-spacing:.2em;font-weight:800}
.af-radio-role{color:var(--red)}
.af-radio-name{color:var(--dim)}
.af-radio-text{font-size:1.05em;font-weight:600;line-height:1.3;color:#fff}

/* telemetry */
.af-tele{position:absolute;left:50%;top:.4vh;transform:translateX(-50%);display:flex;gap:1.4em;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(9px,.62vw,15px);background:rgba(0,0,0,.6);padding:.25em .9em;color:#cfe}
.af-tele-cell{display:flex;gap:.4em;align-items:baseline}
.af-tele-v{font-weight:700;color:#fff;min-width:2.5em;text-align:right}
.af-tele-k{color:var(--dim);font-size:.85em}

/* bottom-left: minimap + lap panel */
.af-hud-left{position:absolute;left:1.2vw;bottom:2.6vh;width:17.5em;font-size:clamp(10px,.8vw,21px);display:flex;flex-direction:column;gap:.6vh}
.af-minimap{height:23vh;background:var(--panel);padding:.6em;position:relative}
.af-minimap .af-trackmap{position:absolute;inset:.6em;width:calc(100% - 1.2em);height:calc(100% - 1.2em)}
.af-lap{background:var(--panel);padding:.6em .8em .7em;border-top:2px solid var(--red)}
.af-lap-top{display:flex;gap:.8em;align-items:stretch}
.af-posbadge{position:relative;z-index:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:4.2em;padding:.2em .5em}
.af-posbadge::before{content:'';position:absolute;inset:0;background:#fff;transform:skewX(-12deg);z-index:-1}
.af-pos-v{color:#000;font-size:2.2em;font-weight:900;font-style:italic;letter-spacing:-.05em;line-height:1}
.af-pos-change{font-size:.72em;font-weight:900;color:#000;min-height:1em}
.af-pos-change.up{color:#0f7d33}.af-pos-change.down{color:#b3140f}
.af-lap-times{flex:1;display:flex;flex-direction:column;justify-content:center;gap:.12em}
.af-lap-row{display:flex;justify-content:space-between;align-items:baseline}
.af-lap-k{font-size:.62em;color:var(--dim);letter-spacing:.16em;font-weight:800}
.af-lap-v{font-variant-numeric:tabular-nums;font-weight:800;font-size:.95em}
.af-lap-v.cur{font-size:1.15em;font-weight:900}
.af-lap-v.best{color:#e4c2ff}
.af-sectors{display:flex;gap:.3em;margin-top:.55em}
.af-sector{flex:1;display:flex;justify-content:space-between;align-items:center;padding:.22em .45em;background:rgba(255,255,255,.08);font-size:.72em;font-variant-numeric:tabular-nums;font-weight:800;min-height:1.7em;transition:background .25s}
.af-sector-k{color:var(--dim);letter-spacing:.06em}
.af-sector.live{background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}
.af-sector.yellow{background:var(--yellow);color:#111}.af-sector.yellow .af-sector-k{color:rgba(0,0,0,.6)}
.af-sector.green{background:var(--green);color:#03210d}.af-sector.green .af-sector-k{color:rgba(0,0,0,.6)}
.af-sector.purple{background:var(--purple);color:#fff}.af-sector.purple .af-sector-k{color:rgba(255,255,255,.7)}
.af-delta{display:flex;align-items:center;gap:.7em;margin-top:.5em}
.af-delta.off{opacity:.3}
.af-delta-track{flex:1;height:.5em;background:rgba(255,255,255,.1);position:relative;overflow:hidden}
.af-delta-centre{position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.5)}
.af-delta-fill{position:absolute;left:0;right:0;top:0;bottom:0;background:var(--green);transform-origin:center;transform:scaleX(0)}
.af-delta.behind .af-delta-fill{background:var(--red)}
.af-delta-v{font-variant-numeric:tabular-nums;font-weight:900;font-size:.95em;min-width:3.4em;text-align:right}
.af-delta.ahead .af-delta-v{color:var(--green)}.af-delta.behind .af-delta-v{color:#ff6a5a}

/* dashboard */
.af-dash{position:absolute;right:1.2vw;bottom:2.6vh;width:27em;font-size:clamp(10px,.82vw,22px);display:flex;flex-direction:column;gap:.5vh}
.af-dash-top{display:flex;gap:.45em;align-items:stretch}
.af-ers{flex:1;background:var(--panel);padding:.4em .7em .5em;border-left:.3em solid #6fa8ff}
.af-ers[data-mode=harvest]{border-left-color:#6fa8ff}.af-ers[data-mode=balanced]{border-left-color:#f7d117}.af-ers[data-mode=overtake]{border-left-color:var(--red)}
.af-ers-head{display:flex;align-items:baseline;gap:.6em;font-size:.68em;letter-spacing:.14em;font-weight:800;margin-bottom:.3em}
.af-ers-k{color:var(--dim)}
.af-ers-mode{color:#fff}
.af-ers.deploying .af-ers-mode{color:#ffd54a}
.af-ers.harvesting .af-ers-mode{color:#8ad0ff}
.af-ers-pct{margin-left:auto;font-variant-numeric:tabular-nums}
.af-ers-bar{height:.55em;background:rgba(255,255,255,.1);position:relative;overflow:hidden}
.af-ers-fill{position:absolute;inset:0;background:linear-gradient(90deg,#3a8dff,#8ad0ff);transform-origin:left}
.af-ers.deploying .af-ers-fill{background:linear-gradient(90deg,#ffb14a,#ffe27a)}
.af-drs,.af-limiter{display:flex;align-items:center;justify-content:center;padding:0 1em;font-weight:900;font-style:italic;letter-spacing:.1em;background:var(--panel);color:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.1);min-width:4.6em;transition:background .15s,color .15s}
.af-drs[data-state=off]{color:rgba(255,255,255,.45)}
.af-drs[data-state=avail]{color:#fff;border-color:#fff;background:rgba(255,255,255,.12)}
.af-drs[data-state=open]{background:var(--green);color:#03210d;border-color:var(--green);box-shadow:0 0 1.2em rgba(37,198,90,.5)}
.af-limiter{font-size:.7em;letter-spacing:.14em}
.af-limiter.on{background:#fff;color:#000;border-color:#fff;animation:af-blink .5s steps(1) infinite}
.af-rpm{display:flex;gap:.2em;padding:.35em .45em;background:var(--panel)}
.af-led{flex:1;height:.85em;background:rgba(255,255,255,.07);transition:background .05s;--c:#25c65a}
.af-led:nth-child(n+7){--c:#f7d117}.af-led:nth-child(n+11){--c:#ff2a1f}.af-led:nth-child(n+14){--c:#7f5cff}
.af-led.lit{background:var(--c);box-shadow:0 0 .6em var(--c)}
.af-rpm.limiter .af-led{animation:af-limiter .12s steps(1) infinite}
@keyframes af-limiter{50%{background:#7f5cff;box-shadow:0 0 .6em #7f5cff}}
.af-dash-mid{display:flex;align-items:stretch;gap:.6em}
.af-pedals{display:flex;gap:.3em}
.af-vbar{width:.9em;background:rgba(10,10,14,.82);position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.1)}
.af-vbar-fill{position:absolute;inset:0;transform-origin:bottom;transform:scaleY(0)}
.af-thr .af-vbar-fill{background:var(--green)}
.af-brk .af-vbar-fill{background:var(--red)}
.af-gearbox{position:relative;z-index:0;flex:0 0 5.6em;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.3em .6em .35em}
.af-gearbox::before{content:'';position:absolute;inset:0;background:var(--panel2);transform:skewX(-12deg);z-index:-1;border-bottom:3px solid var(--red)}
.af-gear{font-size:4.6em;font-weight:900;font-style:italic;line-height:.95;letter-spacing:-.06em}
.af-gear-k,.af-speed-k{font-size:.62em;letter-spacing:.24em;color:var(--dim);font-weight:800}
.af-speedbox{flex:1;background:var(--panel);display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:.3em 1em .35em;position:relative}
.af-speed{font-size:3.6em;font-weight:900;font-style:italic;line-height:.95;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.af-dash-bot{display:flex;gap:.45em;align-items:stretch}
.af-tyres{flex:0 0 auto;background:var(--panel);padding:.45em .6em .4em;display:flex;flex-direction:column;align-items:center;gap:.3em}
.af-tyre-grid{display:grid;grid-template-columns:1.25em 1.6em 1.25em;grid-template-rows:2.1em 2.1em;gap:.25em .35em;grid-template-areas:"fl c fr" "rl c rr"}
.af-tyre-rect{position:relative;background:rgba(255,255,255,.06);border:.14em solid var(--tc,#25c65a);border-radius:.25em;overflow:hidden;display:flex;align-items:center;justify-content:center;transition:border-color .3s}
.af-tyre-rect:nth-child(1){grid-area:fl}.af-tyre-rect:nth-child(2){grid-area:fr}.af-tyre-rect:nth-child(3){grid-area:rl}.af-tyre-rect:nth-child(4){grid-area:rr}
.af-tyre-wear{position:absolute;left:0;right:0;bottom:0;top:0;background:rgba(255,255,255,.28);transform-origin:bottom;transform:scaleY(0)}
.af-tyre-temp{position:relative;font-size:.6em;font-weight:800;font-variant-numeric:tabular-nums}
.af-tyre-centre{grid-area:c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15em}
.af-tyre-compound{width:1.5em;height:1.5em;border-radius:50%;border:.2em solid var(--tyre,#ffd600);display:flex;align-items:center;justify-content:center;font-size:.85em;font-weight:900;background:#111}
.af-tyre-age{font-size:.6em;color:var(--dim);font-weight:800;letter-spacing:.06em}
.af-mini-k{font-size:.56em;letter-spacing:.18em;color:var(--dim);font-weight:800;white-space:nowrap}
.af-damage{background:var(--panel);padding:.45em .6em .4em;display:flex;flex-direction:column;align-items:center;gap:.3em}
.af-damage-svg{height:4.6em;width:auto;display:block}
.af-dmg-static{fill:rgba(255,255,255,.35)}
.af-dmg-part{fill:rgba(255,255,255,.55);transition:fill .3s}
.af-dmg-part[data-l="1"]{fill:#f7d117}.af-dmg-part[data-l="2"]{fill:#ff8c00}.af-dmg-part[data-l="3"]{fill:var(--red)}
.af-dash-right{flex:1;display:flex;flex-direction:column;gap:.35em;min-width:0}
.af-fuel,.af-gforce{background:var(--panel);padding:.35em .7em;display:flex;align-items:baseline;gap:.6em}
.af-fuel-v,.af-gforce-v{font-weight:900;font-style:italic;font-variant-numeric:tabular-nums;font-size:1.1em;margin-left:auto}
.af-fuel-laps{font-size:.62em;color:var(--dim);font-weight:800;letter-spacing:.08em;min-width:4.4em;text-align:right}
.af-steer{background:var(--panel);padding:.4em .7em .35em;display:flex;flex-direction:column;gap:.3em;flex:1;justify-content:center}
.af-steer-track{position:relative;height:.5em;background:rgba(255,255,255,.1)}
.af-steer-centre{position:absolute;left:50%;top:-.15em;bottom:-.15em;width:1px;background:rgba(255,255,255,.5)}
.af-steer-tick{position:absolute;left:50%;top:-.2em;bottom:-.2em;width:.4em;margin-left:-.2em;background:#fff}

/* MFD */
.af-mfd{position:absolute;right:1.2vw;bottom:34vh;width:23em;font-size:clamp(10px,.82vw,22px);background:rgba(8,8,12,.94);border-top:3px solid var(--red);box-shadow:0 1vh 4vh rgba(0,0,0,.6);pointer-events:auto;display:flex;flex-direction:column;padding-bottom:.4em;opacity:0}
.af-mfd.in{animation:af-fadeup .25s cubic-bezier(.2,.8,.2,1) forwards}
.af-mfd .af-hints{margin:.3em .9em 0;padding-top:.4em;border-top:1px solid var(--line);font-size:.62em;gap:1em}
.af-mfd-head{display:flex;align-items:center;gap:.8em;padding:.5em .9em .4em}
.af-mfd-title{font-weight:900;font-style:italic;letter-spacing:.18em;color:var(--red);font-size:.8em}
.af-mfd-tabs{display:flex;gap:.2em;margin-left:auto}
.af-mfd-tab{padding:.25em .6em;font-size:.66em;font-weight:800;letter-spacing:.1em;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent}
.af-mfd-tab.on{color:#fff;border-bottom-color:var(--red)}
.af-mfd-body{padding:.2em .6em .4em}
.af-mfd-page{display:flex;flex-direction:column;gap:.15em}
.af-mfd-page .af-row{padding:.3em .8em .3em .9em;font-size:.9em}
.af-mfd-page .af-row-hint{display:none}
.af-mfd-status{font-size:.7em;letter-spacing:.1em;font-weight:800;color:var(--dim);padding:.3em .5em .5em;text-transform:uppercase}
.af-mfd-status.active{color:#fff}
.af-mfd-row{display:flex;align-items:center;gap:.7em;padding:.45em .8em;background:rgba(255,255,255,.04);border-left:.25em solid transparent;cursor:pointer;transition:background .12s}
.af-mfd-row.focus{background:rgba(255,255,255,.12);border-left-color:var(--red)}
.af-mfd-row.current{box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.af-mfd-row.current .af-mfd-label::after{content:'  ·  CURRENT';color:var(--dim);font-size:.7em;letter-spacing:.14em;white-space:pre}
.af-mfd-row.requested{border-left-color:#fff}
.af-mfd-row.requested .af-mfd-action{color:#fff}
.af-mfd-swatch{display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:50%;border:.2em solid var(--tyre,#ccc);font-size:.75em;font-weight:900;background:#111}
.af-mfd-label{font-weight:800;letter-spacing:.06em;font-size:.9em}
.af-mfd-action{margin-left:auto;font-size:.62em;letter-spacing:.14em;font-weight:800;color:var(--dim)}
.af-mfd-row.focus .af-mfd-action{color:#fff}
.af-mfd-cancel{margin-top:.3em;border-left-color:rgba(255,255,255,.2)}
.af-mfd-desc{margin-left:auto;font-size:.62em;color:var(--dim);text-align:right;letter-spacing:.02em}
.af-mfd-ers[data-mode=harvest]{border-left-color:#6fa8ff}.af-mfd-ers[data-mode=overtake]{border-left-color:var(--red)}.af-mfd-ers[data-mode=balanced]{border-left-color:var(--yellow)}
.af-mfd-ers.focus{border-left-color:var(--red)}
.af-mfd-info{display:flex;justify-content:space-between;padding:.35em .8em;background:rgba(255,255,255,.04);font-size:.82em}
.af-mfd-info-k{color:var(--dim);letter-spacing:.14em;font-weight:800;font-size:.85em}
.af-mfd-info-v{font-weight:800;font-variant-numeric:tabular-nums;white-space:pre}

/* gamepad badge */
.af-gamepad{position:absolute;left:50%;bottom:.6vh;transform:translateX(-50%);display:flex;align-items:center;gap:.5em;font-size:clamp(9px,.62vw,15px);letter-spacing:.2em;font-weight:800;color:var(--dim);padding:.2em .8em;background:rgba(0,0,0,.5)}
.af-gamepad .af-ico{color:#fff}

@media (max-aspect-ratio:3/2){
  .af-menu-panel{width:56vw}
  .af-results-panel{width:74vw}
}
`;
