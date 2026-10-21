// 커뮤니티 UI 스타일. 게임이 --tls-* CSS 변수(theme)로 색을 바꾼다. 크기는 em 단위라 루트 글자 크기로 같이 줄어든다.
export const STYLE_ID = 'tll-social-style';

export const DEFAULT_THEME = Object.freeze({
  panel: '#0e1c3f',
  panel2: '#142a58',
  panel3: '#1a3470',
  border: '#34569e',
  accent: '#ff9a1f',
  accent2: '#ffc43c',
  accentInk: '#3a1d00',
  gold: '#ffcf5a',
  blue: '#2f78e0',
  blue2: '#56a8ff',
  text: '#eef3ff',
  muted: '#8ea3cc',
  red: '#ff4b5c',
  green: '#4fe08a',
  purple: '#b26bff',
  font: 'inherit',
});

export const CSS = `
.tls-root{--tls-sheet-w:380px;--tls-vh:100dvh;position:fixed;inset:0;z-index:70;pointer-events:none;font-family:var(--tls-font);font-size:14px;color:var(--tls-text);line-height:1.35;-webkit-user-select:none;user-select:none}
.tls-root.tls-compact{font-size:12px}
.tls-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.tls-root [hidden]{display:none!important}
:where(.tls-root) button{font-family:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer;touch-action:manipulation}
.tls-root input,.tls-root textarea,.tls-root select{font-family:inherit;font-size:1em;color:var(--tls-text);-webkit-user-select:text;user-select:text}
.tls-svg{display:inline-block;vertical-align:middle;flex:none}
.tls-offscreen{position:fixed;left:-9999px;top:0;opacity:0}
.tls-root button:focus-visible,.tls-root input:focus-visible,.tls-root textarea:focus-visible,.tls-root select:focus-visible{outline:2px solid var(--tls-gold);outline-offset:1px}

/* ---- 공통 버튼 ---- */
.tls-btn{display:inline-flex;align-items:center;justify-content:center;gap:.35em;min-height:2.4em;padding:0 1em;border-radius:.7em;font-weight:800;white-space:nowrap;border:1px solid transparent;transition:filter .12s}
.tls-btn:active{filter:brightness(.9)}
.tls-btn:disabled,.tls-btn.tls-busy{opacity:.55;cursor:default}
.tls-btn-orange{background:linear-gradient(#ffc43c,#ff9a1f);border-color:#b8650a;color:var(--tls-accentInk,#3a1d00);box-shadow:0 2px 0 #8a4a05}
.tls-btn-blue{background:linear-gradient(#56a8ff,#2f78e0);border-color:#1b4e9e;color:#fff;box-shadow:0 2px 0 #153e7c}
.tls-btn-navy{background:linear-gradient(#27407c,#1a2f61);border-color:#3b5aa0;color:#dbe6ff}
.tls-btn-ghost{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.16);color:#dbe6ff}
.tls-btn-red{background:linear-gradient(#ff6b78,#d6283c);border-color:#8f1424;color:#fff}
.tls-btn-sm{min-height:2em;padding:0 .75em;font-size:.92em;border-radius:.6em}
.tls-btn-block{width:100%}
.tls-iconbtn{width:2.4em;height:2.4em;display:inline-flex;align-items:center;justify-content:center;border-radius:.6em;background:rgba(10,20,50,.7);border:1px solid #3b5aa0;color:#dbe6ff}
.tls-link{color:var(--tls-blue2);text-decoration:underline;font-weight:700}

/* ---- 아바타·이름·칭호 ---- */
.tls-avatar{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:50%;overflow:hidden;background:#243a72;border:2px solid #cfae5a;color:#fff;font-weight:900}
.tls-avatar img{width:100%;height:100%;object-fit:cover;object-position:50% 12%;display:block;pointer-events:none}
.tls-avatar-sm{width:2.1em;height:2.1em;font-size:1em}
.tls-avatar-md{width:2.9em;height:2.9em;font-size:1em}
.tls-avatar-lg{width:4.6em;height:4.6em;font-size:1.3em}
.tls-avatar-xl{width:6.4em;height:6.4em;font-size:1.4em;border-width:3px}
.tls-name{font-weight:800;color:#fff;cursor:pointer;text-align:left}
.tls-name:active{color:var(--tls-gold)}
.tls-tag{color:var(--tls-muted);font-weight:600}
.tls-verified{display:inline-flex;vertical-align:-.15em;color:var(--tls-blue2);margin-left:.15em}
.tls-title{display:inline-flex;align-items:center;gap:.3em;max-width:100%;padding:.05em .65em .05em .4em;border-radius:999px;border:1px solid var(--tls-gold);background:rgba(120,84,10,.45);color:var(--tls-gold);font-weight:800;font-size:.88em;white-space:nowrap}
.tls-title.tone-purple{border-color:var(--tls-purple);background:rgba(90,40,150,.5);color:#e5c9ff}
.tls-title.tone-orange{border-color:#ff9a1f;background:rgba(130,60,5,.5);color:#ffc27a}
.tls-title.tone-blue{border-color:var(--tls-blue2);background:rgba(25,70,150,.5);color:#bfe0ff}
.tls-title.tone-gold{border-color:var(--tls-gold)}
.tls-title span{overflow:hidden;text-overflow:ellipsis}
.tls-dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;background:#6a7aa0;flex:none}
.tls-dot.on{background:var(--tls-green);box-shadow:0 0 6px var(--tls-green)}
.tls-count{display:inline-flex;align-items:center;justify-content:center;min-width:1.5em;height:1.5em;padding:0 .4em;border-radius:999px;background:var(--tls-red);color:#fff;font-size:.82em;font-weight:900;line-height:1}
.tls-empty{padding:1.2em .8em;text-align:center;color:var(--tls-muted)}
.tls-empty b{display:block;color:#cdd9f5;margin-bottom:.3em}
.tls-scroll{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#3b5aa0 transparent}
.tls-scroll-x{overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scrollbar-width:none}
.tls-scroll-x::-webkit-scrollbar{display:none}
.tls-section{background:linear-gradient(#142a58,#0f2048);border:1px solid var(--tls-border);border-radius:.9em;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.tls-section-head{display:flex;align-items:center;gap:.5em;padding:.5em .8em;background:linear-gradient(#27498f,#1b3774);border-bottom:1px solid #12285a;font-weight:900;font-size:1.1em;color:#fff;flex:none}
.tls-section-head .tls-right{margin-left:auto;font-weight:600;font-size:.82em;color:#c9d8f7}
.tls-section-head .tls-right b{color:var(--tls-gold)}

/* ---- 사이드 시트 ---- */
.tls-sheet{position:fixed;top:0;right:0;bottom:auto;height:var(--tls-vh);width:var(--tls-sheet-w);display:flex;flex-direction:column;pointer-events:auto;background:linear-gradient(#112250,#0a1633);border-left:2px solid #3b64b8;box-shadow:-8px 0 30px rgba(0,0,0,.55);padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
.tls-head{display:flex;align-items:center;gap:.6em;padding:.45em .5em .45em .9em;background:linear-gradient(#2b63c0,#1c438a);border-bottom:2px solid #0f2a5e;flex:none}
.tls-head h2{margin:0;font-size:1.45em;font-weight:900;color:#fff;letter-spacing:.02em;display:flex;align-items:center;gap:.4em}
.tls-head .tls-conn{margin-left:.3em;font-size:.72em;font-weight:700;color:#cfe0ff;display:flex;align-items:center;gap:.35em}
.tls-head .tls-grow{flex:1}
.tls-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:.35em;padding:.45em .45em .35em;flex:none;background:rgba(8,16,40,.5)}
.tls-tab{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.1em;min-height:3.4em;padding:.25em .1em;border-radius:.8em;background:linear-gradient(#1b3068,#12214a);border:2px solid #29428a;color:#b8caf0;font-weight:800;font-size:.8em;line-height:1.15;text-align:center}
.tls-tab.on{border-color:var(--tls-gold);color:#fff;background:linear-gradient(#27468f,#1a3270);box-shadow:0 0 10px rgba(255,207,90,.35)}
.tls-tab .tls-svg{color:#8fc0ff}
.tls-tab.on .tls-svg{color:var(--tls-gold)}
.tls-tab .tls-count{position:absolute;top:-.35em;right:-.1em}
.tls-compact .tls-tab{min-height:2.9em;font-size:.84em}
.tls-compact .tls-head{padding:.15em .4em .15em .7em}
.tls-compact .tls-head h2{font-size:1.25em}
.tls-compact .tls-head .tls-iconbtn{width:2.1em;height:2.1em}
.tls-compact .tls-tabs{padding:.25em .3em;gap:.25em}
.tls-compact .tls-tab{min-height:2.55em;gap:0;padding:.15em 0}
.tls-compact .tls-tab .tls-svg{width:17px;height:17px}
.tls-compact .tls-chat-bar{padding:.25em .5em}
.tls-compact .tls-pill{min-height:1.8em}
.tls-compact .tls-msg{padding:.35em .1em}
.tls-compact .tls-quick{padding:.25em .5em}
.tls-compact .tls-chip{min-height:1.7em}
.tls-compact .tls-compose{padding:.25em .5em .4em}
.tls-compact .tls-input{min-height:2.2em}
.tls-compact .tls-avatar-md{width:2.4em;height:2.4em}
.tls-sheet-body{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}

/* ---- 채팅 ---- */
.tls-view{display:flex;flex-direction:column;min-height:0;flex:1}
.tls-chat-bar{display:flex;align-items:center;gap:.4em;padding:.4em .6em;flex:none;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
.tls-chat-bar::-webkit-scrollbar{display:none}
.tls-pill{display:inline-flex;align-items:center;gap:.4em;min-height:2.1em;padding:0 .9em;border-radius:999px;background:linear-gradient(#1c3a78,#142a5a);border:1px solid #3e68bd;color:#fff;font-weight:800;white-space:nowrap}
.tls-pill.on{border-color:var(--tls-gold);box-shadow:0 0 8px rgba(255,207,90,.3)}
.tls-pill .tls-count{margin-left:.1em}
.tls-chanmenu{position:absolute;left:.6em;top:3.1em;z-index:5;min-width:14em;max-height:60%;overflow:auto;background:#0f2250;border:1px solid #4a72c8;border-radius:.8em;padding:.3em;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.tls-chanmenu button{display:flex;width:100%;justify-content:space-between;gap:1em;padding:.55em .7em;border-radius:.5em;font-weight:700;text-align:left}
.tls-chanmenu button.on{background:rgba(255,207,90,.16);color:var(--tls-gold)}
.tls-list{flex:1;min-height:0;padding:0 .6em;position:relative}
.tls-msg{display:flex;gap:.6em;padding:.55em .1em;border-bottom:1px solid rgba(120,150,220,.16)}
.tls-msg-main{flex:1;min-width:0}
.tls-msg-top{display:flex;align-items:center;gap:.45em;flex-wrap:wrap}
.tls-msg-top .tls-time{margin-left:auto;color:var(--tls-muted);font-size:.84em;font-weight:600;flex:none}
.tls-msg-text{margin-top:.15em;color:#f3f6ff;font-weight:600;word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap}
.tls-msg.own .tls-msg-text{color:#fff6d6}
.tls-msg.whisper{background:rgba(70,120,230,.12);border-radius:.6em;padding-left:.4em;padding-right:.4em}
.tls-msg .tls-wlabel{color:#9cc8ff;font-weight:800;font-size:.84em}
.tls-fame{display:flex;align-items:center;gap:.6em;margin:.45em 0;padding:.5em .7em;border-radius:.8em;border:2px solid var(--tls-gold);background:linear-gradient(90deg,rgba(130,92,12,.55),rgba(60,45,12,.55));font-weight:800;box-shadow:0 0 12px rgba(255,207,90,.25)}
.tls-fame .tls-svg{color:var(--tls-gold);filter:drop-shadow(0 0 4px rgba(255,207,90,.7))}
.tls-fame .tls-fame-text{flex:1;min-width:0;word-break:break-word}
.tls-fame .tls-fame-text em{font-style:normal;color:var(--tls-gold)}
.tls-fame .tls-time{color:#d9c58a;font-size:.84em;font-weight:600;flex:none}
.tls-sys{margin:.35em 0;padding:.35em .6em;text-align:center;color:var(--tls-muted);font-size:.9em;border-radius:.6em;background:rgba(255,255,255,.04)}
.tls-listing{display:flex;align-items:center;gap:.7em;padding:.45em;margin:.4em 0;border-radius:.8em;background:linear-gradient(#17306a,#10234f);border:2px solid #3e68bd}
.tls-listing .tls-thumb{width:5.2em;height:3.6em;border-radius:.5em;flex:none;background:#1c2f66 center/cover no-repeat;border:1px solid #4a72c8}
.tls-listing .tls-lmain{flex:1;min-width:0}
.tls-listing .tls-ltitle{font-weight:900;color:#fff;font-size:1.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-listing .tls-lsub{color:#b4c6ee;font-weight:600;font-size:.92em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-listing .tls-lhost{color:var(--tls-muted);font-size:.82em}
.tls-listing.big{margin:.35em 0}
.tls-newmsg{position:absolute;left:50%;bottom:.4em;transform:translateX(-50%);z-index:3;padding:.3em .9em;border-radius:999px;background:var(--tls-blue);color:#fff;font-weight:800;box-shadow:0 3px 10px rgba(0,0,0,.5)}
.tls-quick{display:flex;align-items:center;gap:.35em;padding:.35em .6em;flex:none;border-top:1px solid rgba(120,150,220,.2);overflow-x:auto;scrollbar-width:none}
.tls-quick::-webkit-scrollbar{display:none}
.tls-chip{display:inline-flex;align-items:center;gap:.3em;min-height:1.9em;padding:0 .8em;border-radius:999px;background:linear-gradient(#18336f,#11265a);border:1px solid #3e68bd;color:#dbe6ff;font-weight:700;white-space:nowrap;flex:none}
.tls-chip.on{border-color:var(--tls-gold);color:var(--tls-gold);background:linear-gradient(#2a4a8f,#1a3270)}
.tls-chip.tls-round{width:2.2em;padding:0;justify-content:center;font-size:1.05em}
.tls-emoji{display:grid;grid-template-columns:repeat(6,1fr);gap:.2em;position:absolute;left:.6em;bottom:3.4em;z-index:6;padding:.4em;border-radius:.8em;background:#0f2250;border:1px solid #4a72c8;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.tls-emoji button{font-size:1.5em;padding:.15em .2em;border-radius:.4em}
.tls-compose{display:flex;gap:.5em;padding:.4em .6em .6em;flex:none;align-items:center}
.tls-compose .tls-to{display:flex;align-items:center;gap:.3em;font-size:.84em;color:#9cc8ff;font-weight:800;max-width:8em;overflow:hidden;white-space:nowrap}
.tls-input{flex:1;min-width:0;min-height:2.5em;padding:0 .9em;border-radius:.7em;background:#0a1633;border:1px solid #3a5aa5;color:#fff}
.tls-input::placeholder{color:#6f84b3}
textarea.tls-input{padding:.6em .9em;resize:none;line-height:1.4;min-height:5em}
.tls-input.tls-bad{border-color:var(--tls-red)}
.tls-hint{padding:.2em .7em;font-size:.82em;color:var(--tls-muted)}

/* ---- 상태 화면(로딩·오프라인·닉네임) ---- */
.tls-state{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8em;padding:1.2em;text-align:center;background:linear-gradient(#112250,#0a1633)}
.tls-state h3{margin:0;font-size:1.3em;color:#fff}
.tls-state p{margin:0;color:#b4c6ee;max-width:26em}
.tls-state .tls-field{width:min(20em,100%);display:flex;flex-direction:column;gap:.5em}
.tls-err{color:#ff8b97;font-weight:700;min-height:1.4em}
.tls-spin{width:2em;height:2em;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:var(--tls-gold);animation:tls-spin .9s linear infinite}
@keyframes tls-spin{to{transform:rotate(360deg)}}

/* ---- 넓은 화면 프레임 ---- */
.tls-wide{position:fixed;inset:0;pointer-events:auto;padding:var(--tls-margin,16px);padding-top:calc(var(--tls-margin,16px) + env(safe-area-inset-top,0px));padding-bottom:calc(var(--tls-margin,16px) + env(safe-area-inset-bottom,0px));padding-left:calc(var(--tls-margin,16px) + env(safe-area-inset-left,0px));padding-right:calc(var(--tls-margin,16px) + env(safe-area-inset-right,0px));background:radial-gradient(ellipse at 50% 20%,rgba(26,48,110,.96),rgba(5,10,28,.97) 70%);height:var(--tls-vh)}
.tls-frame{position:relative;height:100%;display:grid;grid-template-columns:8.4em minmax(0,1fr);gap:.8em;min-height:0}
.tls-compact .tls-frame{grid-template-columns:4.9em minmax(0,1fr);gap:.5em}
.tls-rail{display:flex;flex-direction:column;gap:.4em;padding:.5em;border-radius:1em;background:linear-gradient(#0f1f48,#0a1633);border:2px solid #243d7c;min-height:0;overflow-y:auto;scrollbar-width:none}
.tls-rail .tls-tab{flex:1;min-height:3.2em;font-size:.95em;background:transparent;border-color:transparent}
.tls-rail .tls-tab.on{background:linear-gradient(#1f3a7a,#142a5a)}
.tls-compact .tls-rail{padding:.3em;gap:.2em}
.tls-compact .tls-rail .tls-tab{font-size:.7em;min-height:2.6em;letter-spacing:-.04em}
.tls-wide-main{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column}
.tls-wide-x{position:absolute;top:-.1em;right:-.1em;z-index:9}
.tls-wide-body{flex:1;min-height:0;display:flex;position:relative}
.tls-wide-body>.tls-view{min-width:0}

/* ---- 친구 ---- */
.tls-friends{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:.8em;height:100%;min-height:0}
.tls-compact .tls-friends{gap:.5em}
.tls-fcol{display:flex;flex-direction:column;gap:.6em;min-height:0}
.tls-compact .tls-fcol{gap:.4em}
.tls-frow{display:flex;align-items:center;gap:.7em;padding:.5em .6em;margin:.35em .5em;border-radius:.8em;background:rgba(8,18,44,.7);border:1px solid #2b4584}
.tls-frow .tls-fmain{flex:1;min-width:0}
.tls-frow .tls-fname{font-weight:800;font-size:1.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-frow .tls-fsub{display:flex;align-items:center;gap:.4em;color:#b4c6ee;font-size:.88em;font-weight:600;overflow:hidden;white-space:nowrap}
.tls-frow .tls-fwhere{display:flex;align-items:center;gap:.4em;color:var(--tls-green);font-weight:700;flex:none;max-width:14em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tls-frow .tls-fwhere.off{color:var(--tls-muted)}
.tls-frow .tls-facts{display:flex;gap:.4em;flex:none;align-items:center}
.tls-compact .tls-frow .tls-fwhere{display:none}
.tls-addrow{display:flex;gap:.5em;padding:.5em .6em}
.tls-reqrow{display:flex;align-items:center;gap:.6em;padding:.3em .6em}
.tls-reqrow .tls-fmain{flex:1;min-width:0;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-profile{align-items:stretch}
.tls-pbox{display:flex;flex-direction:column;align-items:center;gap:.4em;padding:.7em .7em;text-align:center}
.tls-pbox .tls-pname{font-size:1.4em;font-weight:900;display:flex;align-items:center;gap:.3em;justify-content:center;flex-wrap:wrap}
.tls-compact .tls-pbox{flex-direction:row;flex-wrap:wrap;justify-content:flex-start;text-align:left;gap:.6em}
.tls-medal{position:relative;width:11em;height:11em;display:flex;align-items:center;justify-content:center;flex:none}
.tls-medal .tls-laurel{position:absolute;inset:0;width:100%;height:100%}
.tls-medal-core{position:relative;width:7.4em;height:7.4em;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-weight:900;line-height:1.15;background:radial-gradient(circle at 35% 30%,#ffe39a,#c98a1c 55%,#7a4a08);border:3px solid #ffd978;box-shadow:inset 0 0 14px rgba(70,35,0,.7),0 0 16px rgba(255,207,90,.45);color:#2a1500}
.tls-medal-core small{font-size:.78em;font-weight:800}
.tls-medal-core b{font-size:1.15em}
.tls-medal.silver .tls-medal-core{background:radial-gradient(circle at 35% 30%,#e8eefc,#8b9bc4 55%,#4a587d);border-color:#c9d6f5;color:#10204a;box-shadow:inset 0 0 14px rgba(20,30,70,.6),0 0 12px rgba(160,190,255,.3)}
.tls-compact .tls-medal{width:7.6em;height:7.6em}
.tls-compact .tls-medal-core{width:5.1em;height:5.1em;border-width:2px}
.tls-ptitles{width:100%;padding:.2em .7em}
.tls-ptitles .tls-ph{display:flex;align-items:center;gap:.4em;font-weight:900;margin-bottom:.4em}
.tls-ptitles .tls-ph .tls-svg{color:var(--tls-gold)}
.tls-ptitles .tls-ph .tls-btn{margin-left:auto}
.tls-chips{display:flex;flex-wrap:wrap;gap:.4em}
.tls-chips button.tls-title{cursor:pointer}
.tls-chips button.tls-title.rep{box-shadow:0 0 0 2px rgba(255,255,255,.6),0 0 10px rgba(255,207,90,.5)}
.tls-codebox{display:flex;align-items:center;gap:.6em;margin:.4em .7em .7em;padding:.5em .7em;border-radius:.8em;background:rgba(6,14,36,.7);border:1px solid #2b4584}
.tls-codebox .tls-fmain{flex:1;min-width:0}
.tls-codebox small{display:block;color:var(--tls-muted);font-weight:700}
.tls-codebox b{color:#8fc8ff;font-size:1.1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.tls-pscroll{flex:1;min-height:0}

/* ---- 명예의 전당 ---- */
.tls-famewrap{display:flex;flex-direction:column;gap:.5em;height:100%;min-height:0}
.tls-banner{position:relative;flex:none;display:flex;align-items:center;justify-content:center;height:3.6em;margin:0 auto;min-width:min(24em,70%)}
.tls-banner .tls-laurel{position:absolute;height:130%;width:auto;top:-15%;opacity:.95}
.tls-banner .tls-laurel.l{right:calc(100% - .6em)}
.tls-banner .tls-laurel.r{left:calc(100% - .6em)}
.tls-compact .tls-banner .tls-laurel{display:none}
.tls-banner h2{position:relative;margin:0;padding:.1em 1.6em;font-size:2.1em;font-weight:900;color:#4a2a00;letter-spacing:.04em;background:linear-gradient(#ffe9a0,#f2b640 55%,#c98a1c);clip-path:polygon(0 0,100% 0,96% 50%,100% 100%,0 100%,4% 50%);text-shadow:0 1px 0 rgba(255,255,255,.4)}
.tls-compact .tls-banner{height:2.4em}
.tls-compact .tls-banner h2{font-size:1.5em}
.tls-fame-cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.5fr) minmax(0,.9fr);gap:.7em}
.tls-fame-cols.compact{grid-template-columns:minmax(0,1.5fr) minmax(0,.9fr);grid-template-rows:auto minmax(0,1fr)}
.tls-fame-cols.compact .tls-strip{grid-column:1/-1}
.tls-dcard{position:relative;display:flex;align-items:flex-end;min-height:5.4em;margin:.45em;padding:.5em .7em;border-radius:.8em;border:2px solid #2b4584;background:#142a58 center/cover no-repeat;color:#fff;text-align:left;overflow:hidden;flex:none}
.tls-dcard::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,10,30,.05),rgba(5,10,30,.88))}
.tls-dcard>*{position:relative}
.tls-dcard.on{border-color:var(--tls-gold);box-shadow:0 0 12px rgba(255,207,90,.45)}
.tls-dcard b{display:block;font-size:1.2em;font-weight:900;text-shadow:0 1px 4px #000}
.tls-dcard small{display:block;font-weight:700;color:#e8efff;text-shadow:0 1px 3px #000}
.tls-dcard .tls-svg{position:absolute;right:.5em;top:50%;transform:translateY(-50%);color:#fff}
.tls-strip{display:flex;gap:.45em;padding:.1em .1em .3em;min-height:0}
.tls-strip .tls-dcard{margin:0;min-height:3.6em;min-width:9em;max-width:11em;padding:.3em .5em}
.tls-strip .tls-dcard b{font-size:.95em}
.tls-strip .tls-dcard small{font-size:.8em}
.tls-fhead{display:flex;align-items:center;gap:.8em;padding:.4em .6em;background:linear-gradient(90deg,rgba(40,70,140,.7),rgba(15,30,70,.5));border-bottom:1px solid #12285a;flex:none}
.tls-fhead .tls-thumb{width:6em;height:3.2em;border-radius:.5em;background:#1c2f66 center/cover no-repeat;border:1px solid #4a72c8;flex:none}
.tls-fhead h3{margin:0;font-size:1.35em;font-weight:900;color:var(--tls-gold)}
.tls-fhead p{margin:0;font-weight:700;color:#dbe6ff}
.tls-podium{display:grid;grid-template-columns:1fr 1.12fr 1fr;gap:.6em;align-items:end;padding:.9em .7em .4em}
.tls-pod{position:relative;display:flex;flex-direction:column;align-items:center;gap:.2em;padding:1.5em .4em .6em;border-radius:.9em;border:2px solid #3e68bd;background:linear-gradient(#18336f,#0e2150);text-align:center;min-width:0}
.tls-pod.r1{border-color:var(--tls-gold);background:linear-gradient(#5a4210,#241a08);box-shadow:0 0 18px rgba(255,207,90,.4);padding-top:1.9em;padding-bottom:.9em}
.tls-pod.r2{border-color:#b9c6e6;background:linear-gradient(#2c3a62,#121c3d)}
.tls-pod.r3{border-color:#d58a4a;background:linear-gradient(#5b3516,#241408)}
.tls-pod .tls-rk{position:absolute;top:-1em;left:50%;transform:translateX(-50%);width:2.6em;height:2.6em;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.25em;color:#2a1500;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3c0,#e1a52a);border:2px solid #fff0b0;box-shadow:0 0 10px rgba(255,207,90,.6)}
.tls-pod.r2 .tls-rk{background:radial-gradient(circle at 35% 30%,#fff,#aab7d8);border-color:#e7edff;box-shadow:0 0 8px rgba(190,205,240,.5)}
.tls-pod.r3 .tls-rk{background:radial-gradient(circle at 35% 30%,#ffd9b0,#c27a3a);border-color:#ffd2a0;box-shadow:0 0 8px rgba(210,140,70,.5)}
.tls-pod .tls-rk .tls-svg{position:absolute;top:-.95em;color:var(--tls-gold)}
.tls-pod .tls-pname{font-weight:900;font-size:1.05em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-pod .tls-pdate{color:#b4c6ee;font-size:.84em;font-weight:600}
.tls-pod .tls-ptime{display:inline-flex;align-items:center;gap:.3em;padding:.1em .8em;border-radius:999px;background:rgba(4,10,30,.8);border:1px solid #3e68bd;color:#7fe0ff;font-weight:900}
.tls-pod.r1 .tls-ptime{border-color:var(--tls-gold)}
.tls-pod.vacant{opacity:.55}
.tls-pod.vacant .tls-avatar{border-style:dashed;border-color:#4a5f93;background:#101c40}
.tls-compact .tls-podium{gap:.4em;padding:.7em .4em .3em}
.tls-compact .tls-pod{padding:1.3em .2em .4em}
.tls-compact .tls-pod .tls-avatar{width:2.6em;height:2.6em}
.tls-nobody{padding:.5em 1em;text-align:center;color:#d0dcf8;font-weight:700}
.tls-fame-lower{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:.6em;padding:.4em .6em .6em}
.tls-compact .tls-fame-lower{grid-template-columns:1fr}
.tls-mini{border:1px solid #2b4584;border-radius:.8em;background:rgba(6,14,36,.6);overflow:hidden}
.tls-mini h4{margin:0;padding:.4em .7em;font-size:1em;font-weight:900;background:rgba(30,55,120,.5)}
.tls-rank-row{display:flex;align-items:center;gap:.5em;padding:.25em .6em;font-weight:700;border-bottom:1px solid rgba(120,150,220,.12)}
.tls-rank-row .tls-rn{width:1.6em;text-align:center;color:#cdd9f5;font-weight:900;flex:none}
.tls-rank-row .tls-rname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-rank-row .tls-rdate{color:var(--tls-muted);font-size:.84em;flex:none}
.tls-rank-row .tls-rtime{color:#7fe0ff;font-weight:900;flex:none}
.tls-medalnum{display:inline-flex;align-items:center;justify-content:center;width:1.7em;height:1.7em;border-radius:50%;font-weight:900;color:#2a1500;background:radial-gradient(circle at 35% 30%,#fff3c0,#e1a52a);flex:none}
.tls-medalnum.s2{background:radial-gradient(circle at 35% 30%,#fff,#aab7d8)}
.tls-medalnum.s3{background:radial-gradient(circle at 35% 30%,#ffd9b0,#c27a3a)}
.tls-conq-head{display:grid;grid-template-columns:2.4em 1fr auto;gap:.5em;padding:.3em .7em;color:var(--tls-muted);font-size:.82em;font-weight:700;border-bottom:1px solid rgba(120,150,220,.2)}
.tls-me-rank{display:flex;align-items:center;gap:.6em;margin:.4em;padding:.4em .7em;border-radius:.8em;border:2px solid var(--tls-gold);background:linear-gradient(90deg,rgba(130,92,12,.5),rgba(40,30,8,.6));flex:none}
.tls-me-rank .tls-rk{display:flex;flex-direction:column;align-items:center;line-height:1.05;font-weight:800;font-size:.84em;color:#e9d9a4}
.tls-me-rank .tls-rk b{font-size:1.6em;color:var(--tls-gold)}
.tls-me-rank .tls-rname{flex:1;min-width:0;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tls-me-rank .tls-rtime{font-weight:900;color:#fff}
.tls-chatstrip{display:flex;align-items:center;gap:.6em;flex:none;padding:.4em .7em;border-radius:.8em;background:rgba(5,12,34,.9);border:1px solid #243d7c;cursor:pointer;min-height:2.6em}
.tls-chatstrip .tls-svg{color:#9cc8ff}
.tls-chatstrip .tls-cslabel{padding:.1em .7em;border-radius:999px;background:var(--tls-blue);font-weight:800;font-size:.9em;flex:none}
.tls-chatstrip .tls-cstext{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#cfe0ff;font-weight:600}
.tls-chatstrip .tls-count{flex:none}

/* ---- 게시판 ---- */
.tls-board{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:.8em;height:100%;min-height:0;width:100%}
.tls-board.single{grid-template-columns:minmax(0,1fr)}
.tls-board-head{display:flex;align-items:center;gap:.6em;flex-wrap:wrap}
.tls-seg{display:inline-flex;margin-left:auto;border-radius:.7em;overflow:hidden;border:1px solid #3b5aa0}
.tls-seg button{padding:.35em .9em;font-weight:800;color:#b8caf0;background:#101f46}
.tls-seg button.on{background:linear-gradient(#27468f,#1a3270);color:#fff}
.tls-cats{display:flex;gap:.4em;padding:.5em .6em;flex:none;overflow-x:auto;scrollbar-width:none}
.tls-cats::-webkit-scrollbar{display:none}
.tls-cats .tls-chip{min-height:2.2em;padding:0 1em}
.tls-post{position:relative;display:flex;gap:.7em;margin:.4em .5em;padding:.6em .7em;border-radius:.8em;background:rgba(8,18,44,.72);border:2px solid #2b4584;text-align:left;width:calc(100% - 1em)}
.tls-post.on{border-color:#5f8ce0}
.tls-post.pinned{border-color:var(--tls-gold);box-shadow:0 0 12px rgba(255,207,90,.25)}
.tls-post .tls-pmain{flex:1;min-width:0}
.tls-post .tls-ptop{display:flex;align-items:center;gap:.5em;flex-wrap:wrap}
.tls-post .tls-ptitle{font-weight:900;font-size:1.05em;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.tls-post .tls-pexcerpt{color:#aebfe6;font-weight:600;margin:.15em 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tls-post .tls-pmeta{display:flex;align-items:center;gap:.6em;color:var(--tls-muted);font-size:.86em;font-weight:600;flex-wrap:wrap}
.tls-post .tls-pstats{display:flex;gap:.45em;margin-left:auto}
.tls-stat{display:inline-flex;align-items:center;gap:.3em;padding:.15em .7em;border-radius:999px;background:#13275a;border:1px solid #2e4a90;color:#dbe6ff;font-weight:800}
.tls-stat.voted{border-color:var(--tls-gold);color:var(--tls-gold)}
.tls-pin{position:absolute;left:-.3em;top:-.5em;color:var(--tls-gold);filter:drop-shadow(0 1px 2px #000)}
.tls-pinlabel{margin-left:auto;display:inline-flex;align-items:center;gap:.3em;color:var(--tls-gold);font-weight:800;font-size:.9em}
.tls-cat{display:inline-flex;align-items:center;gap:.3em;padding:.05em .7em;border-radius:999px;font-weight:800;font-size:.86em;border:1px solid;white-space:nowrap;flex:none}
.tls-cat.tone-gold{color:var(--tls-gold);border-color:var(--tls-gold);background:rgba(120,84,10,.4)}
.tls-cat.tone-red{color:#ff9aa5;border-color:#ff6b78;background:rgba(150,20,40,.4)}
.tls-cat.tone-green{color:#9cf0bf;border-color:#4fe08a;background:rgba(20,110,60,.4)}
.tls-cat.tone-blue{color:#a9d4ff;border-color:#56a8ff;background:rgba(25,70,150,.45)}
.tls-cat.tone-gray{color:#d5dcf0;border-color:#8c9abf;background:rgba(80,92,125,.4)}
.tls-status{display:inline-flex;align-items:center;gap:.3em;padding:.1em .75em;border-radius:999px;font-weight:800;font-size:.86em;border:1px solid;white-space:nowrap;flex:none}
.tls-status.tone-yellow{color:#ffe083;border-color:#ffcf5a;background:rgba(120,90,10,.45)}
.tls-status.tone-purple{color:#e4c8ff;border-color:#b26bff;background:rgba(90,40,150,.5)}
.tls-status.tone-green{color:#9cf0bf;border-color:#4fe08a;background:rgba(20,110,60,.45)}
.tls-status.tone-gray{color:#d5dcf0;border-color:#8c9abf;background:rgba(80,92,125,.45)}
.tls-detail{display:flex;flex-direction:column;min-height:0;height:100%}
.tls-detail .tls-dscroll{flex:1;min-height:0;padding:.7em .8em}
.tls-dtitle{display:flex;align-items:center;gap:.5em;flex-wrap:wrap;margin-bottom:.4em}
.tls-dtitle h3{margin:0;font-size:1.2em;font-weight:900;flex:1;min-width:0;word-break:break-word}
.tls-dauthor{display:flex;align-items:center;gap:.6em;margin:.3em 0 .6em;color:var(--tls-muted);font-weight:600;font-size:.9em}
.tls-dbody{font-weight:600;color:#eef3ff;white-space:pre-wrap;word-break:break-word;margin-bottom:.8em}
.tls-devreply{display:flex;gap:.8em;padding:.6em .8em;margin:.6em 0;border-radius:.9em;border:2px solid var(--tls-gold);background:linear-gradient(90deg,rgba(130,92,12,.55),rgba(40,30,8,.6))}
.tls-devreply .tls-svg{color:var(--tls-gold);flex:none}
.tls-devreply b{color:var(--tls-gold);display:block;margin-bottom:.2em}
.tls-devreply p{margin:0;white-space:pre-wrap;word-break:break-word;font-weight:600}
.tls-diagbox{margin:.5em 0;padding:.5em .7em;border-radius:.7em;border:1px dashed #4a72c8;background:rgba(10,24,60,.7);color:#b4c6ee;font-size:.88em}
.tls-diagbox b{display:block;color:#dbe6ff;margin-bottom:.2em}
.tls-comment{padding:.5em 0;border-top:1px solid rgba(120,150,220,.16)}
.tls-comment .tls-ctop{display:flex;align-items:center;gap:.4em;flex-wrap:wrap}
.tls-comment .tls-time{margin-left:auto;color:var(--tls-muted);font-size:.84em}
.tls-comment p{margin:.15em 0 0;white-space:pre-wrap;word-break:break-word;font-weight:600}
.tls-devtag{padding:.02em .5em;border-radius:999px;background:var(--tls-gold);color:#2a1500;font-weight:900;font-size:.78em}
.tls-dactions{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;margin:.5em 0}
.tls-dfoot{flex:none;padding:.5em .8em;border-top:1px solid rgba(120,150,220,.2);display:flex;flex-direction:column;gap:.5em}
.tls-discord{display:flex;align-items:center;gap:.8em}
.tls-discord .tls-dtext{flex:1;min-width:0;font-weight:900}
.tls-discord .tls-dtext small{display:block;color:var(--tls-muted);font-weight:600}
.tls-btn-discord{background:linear-gradient(#6d7cff,#4a57d6);border-color:#323fa6;color:#fff;box-shadow:0 2px 0 #2a3590}
.tls-admin{margin:.6em 0;padding:.6em;border-radius:.8em;border:1px dashed var(--tls-red);background:rgba(120,20,40,.2)}
.tls-admin b{display:block;margin-bottom:.4em;color:#ff9aa5}
.tls-admin .tls-chips{margin-bottom:.5em}

/* ---- 팝오버·모달·토스트 ---- */
.tls-menu{position:fixed;z-index:30;min-width:9em;padding:.3em;border-radius:.8em;background:#0f2250;border:1px solid #4a72c8;box-shadow:0 8px 24px rgba(0,0,0,.65);pointer-events:auto}
.tls-menu button{display:block;width:100%;padding:.55em .9em;border-radius:.5em;text-align:left;font-weight:800;color:#eef3ff}
.tls-menu button:hover,.tls-menu button:active{background:rgba(255,207,90,.16);color:var(--tls-gold)}
.tls-menu button[disabled]{opacity:.45}
.tls-menu button.danger{color:#ff9aa5}
.tls-modal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:1em;background:rgba(2,6,18,.66);pointer-events:auto}
.tls-modal-box{display:flex;flex-direction:column;width:min(30em,100%);max-height:100%;border-radius:1em;background:linear-gradient(#142a58,#0c1a3c);border:2px solid #4a72c8;box-shadow:0 16px 50px rgba(0,0,0,.7);overflow:hidden}
.tls-modal-box.wide{width:min(38em,100%)}
.tls-modal-head{display:flex;align-items:center;gap:.5em;padding:.55em .6em .55em .9em;background:linear-gradient(#2b63c0,#1c438a);font-weight:900;font-size:1.15em;flex:none}
.tls-modal-head .tls-grow{flex:1}
.tls-modal-body{flex:1;min-height:0;padding:.8em .9em;display:flex;flex-direction:column;gap:.6em}
.tls-modal-foot{display:flex;gap:.5em;justify-content:flex-end;padding:.6em .9em .8em;flex:none}
.tls-modal label{display:flex;flex-direction:column;gap:.25em;font-weight:800;color:#cfe0ff}
.tls-modal .tls-note{color:var(--tls-muted);font-size:.9em;font-weight:600;margin:0}
.tls-modal .tls-blur{filter:blur(6px);transition:filter .15s}
.tls-modal .tls-blur.show{filter:none}
.tls-secret{padding:.5em .7em;border-radius:.6em;background:#08122c;border:1px solid #2e4a90;font-family:ui-monospace,Consolas,monospace;word-break:break-all;font-size:.9em}
.tls-toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(8px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:center;gap:.4em;pointer-events:none;z-index:50;max-width:min(92vw,24em)}
.tls-toast{display:flex;align-items:center;gap:.7em;padding:.55em .9em;border-radius:.8em;background:rgba(10,22,54,.96);border:1px solid #4a72c8;box-shadow:0 6px 18px rgba(0,0,0,.55);font-weight:700;pointer-events:auto;animation:tls-pop .18s ease-out}
.tls-toast.warn{border-color:var(--tls-red)}
.tls-toast.good{border-color:var(--tls-green)}
@keyframes tls-pop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}

/* ---- 전투 중 띠 ---- */
.tls-ticker{position:fixed;pointer-events:none;display:flex;flex-direction:column;gap:2px;overflow:hidden;z-index:6}
.tls-ticker .tls-tline{padding:.1em .5em;border-radius:.4em;background:rgba(6,12,30,.62);color:#eef3ff;font-weight:700;font-size:12px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity 1.2s ease;opacity:1}
.tls-ticker .tls-tline.fade{opacity:.28}
.tls-ticker .tls-tline.fame{color:var(--tls-gold)}
.tls-badge-corner{position:fixed;pointer-events:none;display:flex;align-items:center;gap:.25em;padding:.1em .5em;border-radius:999px;background:rgba(6,12,30,.7);color:#eef3ff;font-weight:900;font-size:11px;z-index:6}
.tls-badge-corner .tls-svg{color:#9cc8ff}

.tls-dcard{width:calc(100% - .9em)}
.tls-strip .tls-dcard{width:auto}
.tls-podium{padding-top:1.7em}
.tls-rail .tls-railx{flex:none;min-height:3em;margin-top:auto;background:rgba(255,255,255,.04);border-color:transparent}
@media (prefers-reduced-motion:reduce){.tls-spin{animation:none}.tls-toast{animation:none}.tls-ticker .tls-tline{transition:none}}
`;

/** 테마 객체를 루트의 CSS 변수(--tls-*)로 적용한다. 알려진 키만 받고 값은 CSS 값 문자열이어야 한다. */
export function applyTheme(root, theme) {
  const merged = { ...DEFAULT_THEME, ...(theme && typeof theme === 'object' ? theme : {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in DEFAULT_THEME)) continue;
    if (typeof value !== 'string' || /[;{}<>]/.test(value)) continue;
    root.style.setProperty('--tls-' + key, value);
  }
}

/** 스타일 태그는 문서에 한 번만 넣는다. */
export function injectStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
