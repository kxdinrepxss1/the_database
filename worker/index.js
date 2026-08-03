// Single source of truth for the build. Names the service-worker cache and is
// stamped onto error reports so a report can be tied to the code that produced
// it. Bump it whenever the client script changes.
const VERSION = "v19";

const page = (route, env) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b0f0d">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="The Database">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>The Database | Sports Card Collection</title>
  <style>
    :root{--bg:#0b0f0d;--panel:#141916;--panel2:#19201c;--line:#2a332d;--text:#f5f7f3;--muted:#929b94;--accent:#7dd3fc}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}button,input,select{font:inherit}button,a{color:inherit}button{cursor:pointer}a{text-decoration:none}.kicker{margin:0;color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.primary,.outline,.danger{display:inline-flex;min-height:41px;align-items:center;justify-content:center;padding:0 16px;border-radius:8px;font-size:12px;font-weight:850}.primary{color:#0a0e0b;border:0;background:var(--accent)}.outline{border:1px solid var(--line);background:#171c19}.danger{color:#ff9a9a;border:1px solid #70383b;background:#2a1618}.danger:hover{color:#fff;border-color:#a94c51;background:#411d20}.hidden{display:none!important}.route-section{display:none}body[data-page="home"] .home-page,body[data-page="collection"] .collection-page,body[data-page="pricing"] .pricing-page,body[data-page="scan"] .scan-page,body[data-page="account"] .account-page{display:grid}header nav a.active{color:var(--accent)}.header-actions{display:flex;align-items:center;gap:10px;justify-self:end}.header-actions .outline{white-space:nowrap}.sync-status{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:#111612;color:#9aa39c;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.sync-status:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.sync-status.ok{color:#8fb08c}.sync-status.pending{color:var(--accent)}.sync-status.offline{color:#ffb27b}.sync-status.error{color:#ff9a9a}@media(max-width:880px){.sync-status span{display:none}.sync-status{padding:7px}}
    header{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:74px;padding:0 5vw;border-bottom:1px solid #ffffff12;background:#0b0f0de8;backdrop-filter:blur(16px)}.brand{display:flex;align-items:center;gap:11px;width:max-content;font-weight:850;letter-spacing:-.03em}.logo{position:relative;width:38px;height:42px;background:var(--accent);clip-path:polygon(50% 0,96% 18%,96% 72%,50% 100%,4% 72%,4% 18%)}.logo:before{content:"";position:absolute;inset:3px;background:#0b0f0d;clip-path:inherit}.logo i{position:absolute;z-index:2;width:14px;height:18px;left:9px;top:8px;border:2px solid #f4f1e8;border-radius:2px;background:#0b0f0d;box-shadow:4px 1px 0 -1px var(--accent),8px 2px 0 -1px var(--accent)}.logo b{position:absolute;z-index:3;width:25px;height:11px;left:6px;bottom:8px;background:#f4f1e8;clip-path:polygon(0 0,20% 0,29% 28%,71% 28%,80% 0,100% 0,94% 100%,6% 100%)}.logo b:after{content:"";position:absolute;width:8px;height:3px;left:9px;bottom:2px;background:var(--accent)}header nav{display:flex;align-self:stretch;gap:34px}header nav a{display:grid;place-items:center;color:var(--muted);font-size:13px;font-weight:750}header nav a:hover{color:var(--text)}header .outline{justify-self:end}
    .hero{position:relative;padding:84px max(5vw,calc((100vw - 1340px)/2)) 58px;overflow:hidden;border-bottom:1px solid var(--line);background:radial-gradient(circle at 78% 25%,#26372d 0,transparent 27%),linear-gradient(110deg,#7dd3fc08,transparent 38%)}.hero:before{content:"";position:absolute;inset:0;opacity:.24;background-image:linear-gradient(#ffffff0a 1px,transparent 1px),linear-gradient(90deg,#ffffff0a 1px,transparent 1px);background-size:52px 52px;mask-image:linear-gradient(black,transparent)}.hero>*{position:relative}.hero-row{display:grid;grid-template-columns:1.3fr .7fr;gap:7vw;align-items:end;margin-top:28px}.hero h1,.pricing h2,.future h2{margin:0;font-size:clamp(54px,6.5vw,94px);line-height:.91;letter-spacing:-.075em}.hero h1 em,.pricing h2 em,.future h2 em{color:var(--accent);font-style:normal}.hero-copy{max-width:620px;margin:27px 0 0;color:#abb3ad;font-size:16px;line-height:1.65}.stats{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:12px;background:#121714cc;overflow:hidden}.stats div{display:flex;flex-direction:column;gap:8px;padding:21px}.stats div+div{border-left:1px solid var(--line)}.stats small,.stats span{color:#7f8881;font-size:9px;letter-spacing:.08em}.stats strong{font-size:25px}.stats span{color:var(--accent)}.search{display:flex;max-width:900px;height:68px;align-items:center;gap:15px;margin-top:50px;padding:0 19px;color:#879087;border:1px solid #3b453e;border-radius:11px;background:#181e1a;box-shadow:0 20px 55px #0005}.search:focus-within{border-color:var(--accent)}.search svg{width:20px;fill:none;stroke:currentColor;stroke-width:2}.search input{min-width:0;flex:1;height:100%;color:var(--text);border:0;outline:0;background:transparent}.search kbd{padding:6px;border:1px solid #38413b;border-radius:5px;background:#111512;font-size:10px}.dashboard{display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-top:38px}.chart-card,.metric-card{border:1px solid var(--line);border-radius:14px;background:#111613e8}.chart-card{min-width:0;padding:24px}.chart-head{display:flex;align-items:end;justify-content:space-between;gap:20px}.chart-head h2{margin:8px 0 0;font-size:28px;letter-spacing:-.045em}.chart-head aside{text-align:right}.chart-head aside strong{display:block;color:var(--accent);font-size:26px}.chart-head aside small{color:var(--muted);font-size:9px}.growth-chart{width:100%;height:180px;margin-top:20px;overflow:visible}.chart-grid{stroke:#ffffff10;stroke-width:1}.growth-area{fill:#7dd3fc18}.growth-line{fill:none;stroke:var(--accent);stroke-width:3;vector-effect:non-scaling-stroke}.metric-stack{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metric-card{display:flex;min-height:116px;justify-content:center;flex-direction:column;padding:19px}.metric-card small{color:var(--muted);font-size:8px;letter-spacing:.08em;text-transform:uppercase}.metric-card strong{margin-top:8px;font-size:25px}.metric-card span{margin-top:5px;color:var(--accent);font-size:9px}.progress{height:6px;margin-top:14px;overflow:hidden;border-radius:99px;background:#252d28}.progress i{display:block;width:0;height:100%;background:var(--accent);transition:width .3s}
    .catalog{max-width:1440px;margin:auto;padding:76px 5vw 105px}.heading{display:flex;align-items:end;justify-content:space-between;gap:20px}.heading h2{margin:10px 0 0;font-size:42px;letter-spacing:-.05em}.heading-actions{display:flex;align-items:center;gap:15px}.heading-actions small{color:#747d76;white-space:nowrap}.filters{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:30px 0 26px;padding:9px;border:1px solid var(--line);border-radius:11px;background:#101411}.tabs,.selects{display:flex;gap:4px}.tabs button{height:38px;padding:0 15px;color:#858e87;border:0;border-radius:7px;background:transparent;font-size:12px;font-weight:750}.tabs button.active{color:#0b0f0d;background:var(--accent)}.selects select{height:38px;min-width:145px;padding:0 12px;color:#c3c9c4;border:1px solid #303833;border-radius:7px;background:#1a201d;font-size:11px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 17px}.catalog-card{overflow:hidden;border:1px solid var(--line);border-radius:12px;outline:0;background:#111512;cursor:pointer;transition:.2s}.catalog-card:hover,.catalog-card:focus-visible{border-color:#5b675f;box-shadow:0 18px 45px #0006;transform:translateY(-5px)}.visual{position:relative;padding:19px;background:radial-gradient(circle at 50% 100%,#ffffff10,transparent 50%),#191f1b}
    .card-art{position:relative;isolation:isolate;width:min(100%,220px);aspect-ratio:2.5/3.5;margin:auto;padding:12px;overflow:hidden;color:#fff;border:3px solid #eff4ec;border-radius:8px;background:linear-gradient(135deg,#24425c 0 46%,#0d1c2a 46%);box-shadow:0 16px 30px #0007;transform:rotate(-1deg)}.catalog-card:nth-child(even) .card-art{transform:rotate(1deg)}.card-art:after{content:"";position:absolute;z-index:-1;inset:8px;border:1px solid #ffffff55;border-radius:4px}.card-art.has-photo{padding:0;background:#090b0a}.card-art.has-photo:after{display:none}.card-photo{width:100%;height:100%;object-fit:cover}.card-art.red{background:linear-gradient(135deg,#a82a2d 0 46%,#350c11 46%)}.card-art.gold,.card-art.yellow{background:linear-gradient(135deg,#b88a1e 0 46%,#3f2c08 46%)}.card-art.orange{background:linear-gradient(135deg,#ca6119 0 46%,#491b08 46%)}.card-art.purple{background:linear-gradient(135deg,#75449d 0 46%,#251132 46%)}.card-art.silver{color:#121713;background:linear-gradient(135deg,#eef2ef 0 46%,#8f9b95 46%)}.card-year,.card-set{position:absolute;top:13px;font-size:8px;font-weight:900;text-transform:uppercase}.card-year{left:13px}.card-set{right:13px}.orbit{position:absolute;z-index:-1;width:125%;aspect-ratio:1;left:-55%;top:12%;border:24px solid #ffffff17;border-radius:50%}.initials{position:absolute;display:grid;width:68%;aspect-ratio:1;left:16%;top:20%;place-items:center;border:1px solid #ffffff70;border-radius:50%;background:#0002;font-size:clamp(40px,5vw,72px);font-style:italic;letter-spacing:-.12em;text-shadow:4px 5px #0003;transform:skew(-5deg)}.art-name{position:absolute;right:12px;bottom:21px;left:12px;display:flex;flex-direction:column;padding:8px;color:white;background:#050806c9;transform:skew(-5deg)}.art-name b,.art-name small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:skew(5deg)}.art-name b{font-size:12px;text-transform:uppercase}.art-name small{margin-top:2px;color:#ffffffb3;font-size:7px}.card-num{position:absolute;right:14px;bottom:9px;font-size:7px}.card-art.mini{width:102px;border-width:2px}.card-art.mini .initials{font-size:29px}.card-art.mini .art-name b{font-size:7px}.card-art.mini .art-name small{display:none}.grade,.quantity{position:absolute;top:12px;padding:6px 8px;color:#101410;border-radius:5px;background:var(--accent);font-size:8px}.grade{right:12px}.quantity{left:12px;background:#f5f7f3}.card-info{position:relative;padding:15px}.card-info h3{margin:0 0 5px;font-size:14px}.card-info p{margin:0;color:#778079;font-size:10px}.price-tag{position:absolute;right:15px;top:15px;display:flex;align-items:end;flex-direction:column}.price-tag strong{color:var(--accent);font-size:14px}.price-tag small{color:#69726b;font-size:7px;text-transform:uppercase}.meta{display:flex;justify-content:space-between;gap:10px;margin-top:14px;padding-top:11px;color:#89918a;border-top:1px solid #252b27;font-size:8px;text-transform:uppercase}.meta span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.empty{display:grid;min-height:320px;place-items:center;align-content:center;text-align:center;border:1px dashed #354039;border-radius:12px}.empty h3{margin-bottom:0}.empty p{color:var(--muted)}
    .pricing{grid-template-columns:.72fr 1.28fr;gap:7vw;min-height:calc(100vh - 74px);padding:100px max(5vw,calc((100vw - 1340px)/2));background:#0e1210}.pricing h2,.future h2{margin-top:20px;font-size:clamp(48px,5vw,72px)}.pricing-copy>p:not(.kicker),.future-copy>p:not(.kicker){max-width:470px;color:var(--muted);line-height:1.7}.pricing-copy .primary{margin-top:17px}.success{display:block;max-width:390px;margin-top:13px;color:var(--accent);line-height:1.5}.comp-card{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}.price-list{display:grid;gap:10px}.price-row{display:grid;grid-template-columns:1fr 135px 78px;gap:10px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}.price-row h3{margin:0 0 4px;font-size:13px}.price-row p{margin:0;color:var(--muted);font-size:9px}.price-input{width:100%;height:42px;padding:0 12px;color:var(--text);border:1px solid #3b453e;border-radius:8px;outline:0;background:#0f1411}.price-input:focus{border-color:var(--accent)}.saved{color:var(--accent);font-size:9px}.formula{display:grid;grid-template-columns:repeat(3,1fr);margin-top:12px;overflow:hidden;border:1px solid var(--line);border-radius:9px}.formula>div{display:flex;flex-direction:column;gap:6px;padding:14px}.formula>div+div{border-left:1px solid var(--line)}.formula small{color:#6f7871;font-size:7px}.formula strong{font-size:11px}.note{margin:17px 0 12px;color:#7e8780;font-size:9px;line-height:1.6}.note b{color:#b9c0ba}.ebay{color:var(--accent);font-size:10px;font-weight:800}
    .future{grid-template-columns:.7fr 1.15fr;gap:24px 6vw;min-height:calc(100vh - 74px);padding:100px max(5vw,calc((100vw - 1340px)/2));border-top:1px solid var(--line)}.future-copy{grid-row:span 2}.scan-card{display:grid;grid-template-columns:1.1fr .9fr;min-height:340px;overflow:hidden;text-align:left;border:1px solid var(--line);border-radius:15px;background:var(--panel)}.scan-card>div{padding:38px}.scan-card h3,.tracking h3{margin:18px 0 9px;font-size:34px;letter-spacing:-.05em}.scan-card>div>p:not(.kicker){color:var(--muted);font-size:12px;line-height:1.6}.scan-card>div>b{display:block;margin-top:26px;font-size:10px}.scanner{position:relative;display:grid;place-items:center;border-left:1px solid var(--line);background:radial-gradient(circle,#34463b,#111613 66%)}.scanner>i,.scan-frame>i{position:absolute;z-index:4;width:75%;height:70%;border:1px solid var(--accent);border-radius:7px}.scanner>i:after,.scan-frame>i:after{content:"";position:absolute;left:8%;top:25%;width:84%;height:2px;background:var(--accent);box-shadow:0 0 10px var(--accent);animation:scan 2.6s infinite ease-in-out}@keyframes scan{50%{top:75%}}.scanner>small{position:absolute;bottom:20px;color:#a4aca5;font-size:8px;text-transform:uppercase}.tracking{min-height:320px;padding:33px;overflow:hidden;border:1px solid var(--line);border-radius:15px;background:var(--panel)}.tracking-head{display:flex;align-items:center;justify-content:space-between}.tracking-head strong{font-size:29px}.tracking svg{width:100%;height:145px}.tracking .area{fill:#7dd3fc25;stroke:none}.tracking .line{fill:none;stroke:var(--accent);stroke-width:3;vector-effect:non-scaling-stroke}.tracking>small{color:#7f8881}.tracking>small b{color:var(--accent)}footer{display:flex;max-width:1440px;align-items:center;justify-content:space-between;margin:auto;padding:36px 5vw;color:#6e7770;border-top:1px solid var(--line);font-size:9px;text-transform:uppercase}footer .brand{color:#ced4cf;font-size:13px;text-transform:none}footer .logo{width:27px;height:31px}
    .account-page{min-height:calc(100vh - 74px);place-items:center;padding:70px 20px;background:radial-gradient(circle at 50% 20%,#25372d,transparent 42%)}.account-shell{width:min(560px,100%);padding:34px;border:1px solid var(--line);border-radius:18px;background:#111613}.account-shell h1{margin:12px 0 8px;font-size:42px;letter-spacing:-.055em}.account-shell>p{color:var(--muted);line-height:1.6}.auth-form{display:grid;gap:13px;margin-top:25px}.auth-form input{height:48px;padding:0 14px;color:var(--text);border:1px solid #3b453e;border-radius:8px;outline:0;background:#0b0f0d}.auth-form input:focus{border-color:var(--accent)}.auth-switch{margin-top:14px;color:var(--accent);border:0;background:none;font-size:11px}.auth-message{min-height:18px;margin:12px 0 0!important;color:#ff9a9a!important;font-size:11px}.account-actions{display:grid;gap:10px;margin-top:25px}.cloud-badge{display:inline-flex;width:max-content;padding:7px 9px;color:#0b0f0d;border-radius:999px;background:var(--accent);font-size:9px;font-weight:900;text-transform:uppercase}footer{display:flex;max-width:1440px;align-items:center;justify-content:space-between;margin:auto;padding:36px 5vw;color:#6e7770;border-top:1px solid var(--line);font-size:9px;text-transform:uppercase}footer .brand{color:#ced4cf;font-size:13px;text-transform:none}footer .logo{width:27px;height:31px}
    .backdrop{position:fixed;z-index:100;inset:0;display:none;padding:24px;place-items:center;overflow-y:auto;background:#030504dd;backdrop-filter:blur(12px)}.backdrop.open{display:grid}.modal{position:relative;display:grid;grid-template-columns:.85fr 1.15fr;width:min(960px,100%);max-height:calc(100vh - 48px);overflow-y:auto;border:1px solid #3a443d;border-radius:17px;background:var(--panel);box-shadow:0 30px 90px #000b}.modal.form-modal{display:block;width:min(760px,100%)}.close{position:absolute;z-index:8;display:grid;width:35px;height:35px;right:17px;top:17px;place-items:center;color:#adb5af;border:1px solid #3b443e;border-radius:50%;background:#111512;font-size:21px}.modal-visual,.scan-stage{display:grid;min-height:575px;padding:45px 30px;place-items:center;align-content:center;gap:15px;border-right:1px solid var(--line);background:radial-gradient(circle,#33453a,#101411 67%)}.modal-visual .card-art{width:255px}.flip-photo{min-height:34px}.modal-copy{padding:60px 45px}.modal-copy h2{margin:14px 0 7px;font-size:44px;letter-spacing:-.055em}.modal-sub{margin:0 0 22px;color:var(--muted);line-height:1.6}.manual-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}.field{display:grid;gap:7px}.field.full{grid-column:1/-1}.field span{color:#9ca59e;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.field input,.field select,.field textarea{width:100%;padding:0 13px;color:var(--text);border:1px solid #3b453e;border-radius:8px;outline:0;background:#0f1411}.field input,.field select{height:46px}.field textarea{min-height:88px;padding-top:12px;resize:vertical}.field input[type=file]{height:auto;padding:12px}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent)}.photo-hint{color:#717b74;font-size:9px;line-height:1.5}.photo-preview{display:none;width:110px;aspect-ratio:2.5/3.5;margin-top:8px;object-fit:cover;border:2px solid #eff4ec;border-radius:7px}.photo-preview.show{display:block}.photo-pair{display:flex;gap:16px}.form-error{display:none;grid-column:1/-1;margin:0;color:#ff8d8d;font-size:10px}#duplicateWarning{grid-column:1/-1;margin-top:0}#duplicateWarning p{color:#e4c7c8;font-size:11px;line-height:1.5}.form-error.show{display:block}.form-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;grid-column:1/-1;margin-top:10px}.value-box{display:flex;flex-direction:column;gap:5px;margin:20px 0;padding:17px;border:1px solid var(--line);border-radius:9px;background:var(--panel2)}.value-box small{color:#747d76;font-size:7px}.value-box strong{font-size:30px}.value-box span{color:var(--accent);font-size:8px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin:18px 0;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--line)}.detail-grid div{padding:12px;background:var(--panel2)}.detail-grid small{display:block;color:#747d76;font-size:7px;text-transform:uppercase}.detail-grid b{display:block;margin-top:5px;font-size:11px}.detail-note{padding:12px;color:#aab2ac;border:1px solid var(--line);border-radius:9px;background:#101411;font-size:10px;line-height:1.55}.modal-copy h4{margin:20px 0 7px;font-size:11px;text-transform:uppercase}.modal-sale{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line);font-size:10px}.modal-sale span{display:flex;flex-direction:column}.modal-sale small{color:#778079}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.remove-confirm{display:none;margin-top:13px;padding:14px;border:1px solid #70383b;border-radius:9px;background:#241517}.remove-confirm.show{display:block}.remove-confirm p{margin:0;color:#e4c7c8;font-size:11px;line-height:1.5}.remove-confirm .actions{margin-top:12px}.scan-stage{align-content:center;gap:20px}.scan-frame{position:relative;width:230px;padding:14px;border:1px solid var(--accent);border-radius:10px}.scan-frame .card-art{width:100%}.scan-frame>i{left:12.5%;top:15%}.scan-check{position:absolute;z-index:7;display:none;width:45px;height:45px;right:-15px;top:-15px;place-items:center;color:#101410;border:4px solid #172018;border-radius:50%;background:var(--accent);font-size:20px}.scan-stage.done .scan-check{display:grid}.scan-result{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin:22px 0;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--line)}.scan-result p{display:flex;min-height:66px;flex-direction:column;justify-content:center;gap:5px;margin:0;padding:10px;background:var(--panel2)}.scan-result small{color:#6f7871;font-size:7px}.scan-result b{font-size:10px}.scan-result p:last-child b{color:var(--accent)}.wide{width:100%}
    @media(max-width:1050px){.hero-row{grid-template-columns:1fr}.stats{max-width:550px}.dashboard{grid-template-columns:1fr}.metric-stack{grid-template-columns:1fr 1fr;grid-template-rows:auto}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.pricing{grid-template-columns:1fr}.future{grid-template-columns:1fr}.future-copy{grid-row:auto}}
    .mobile-nav{display:none}.install{display:none}.scan-preview{width:100%;height:100%;min-height:330px;object-fit:cover;border-radius:8px}.scan-upload-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}.scan-upload{display:grid;min-height:116px;padding:14px;place-items:center;align-content:center;gap:8px;color:#aab3ac;border:1px dashed #455148;border-radius:10px;background:#0f1411;text-align:center;font-size:10px}.scan-upload.ready{color:var(--accent);border-style:solid;border-color:#3f7ea3;background:#101a20}.scan-upload b{font-size:22px}.scan-actions{display:flex;flex-wrap:wrap;gap:9px}.scan-error{min-height:18px;margin:12px 0 0;color:#ff9a9a;font-size:10px;line-height:1.5}.scan-note{color:#7f8981;font-size:9px;line-height:1.5}.app-badge{display:inline-flex;align-items:center;gap:7px;margin-top:16px;padding:8px 10px;border:1px solid #334039;border-radius:999px;color:#aab3ac;background:#111612;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.app-badge:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
    @media(max-width:760px){body{padding-bottom:78px}header{height:64px;grid-template-columns:1fr auto;padding:env(safe-area-inset-top) 18px 0}header nav{display:none}header .outline{min-height:36px}.hero{padding:47px 20px 38px}.hero h1{font-size:clamp(48px,14vw,68px)}.hero-copy{font-size:14px}.stats{width:100%}.stats div{padding:16px}.search{height:56px;margin-top:30px}.search kbd{display:none}.catalog,.pricing,.future{padding:55px 20px 70px}.filters{align-items:stretch;flex-direction:column}.selects{display:grid;grid-template-columns:1fr 1fr}.selects select{width:100%;min-width:0}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.comp-head{align-items:start;flex-direction:column}.comp-head>aside{align-items:start}.scan-card{grid-template-columns:1fr}.scanner{min-height:270px;border-top:1px solid var(--line);border-left:0}.modal{grid-template-columns:1fr}.modal-visual,.scan-stage{min-height:360px;border-right:0;border-bottom:1px solid var(--line)}footer{display:none}.mobile-nav{position:fixed;z-index:80;right:0;bottom:0;left:0;display:grid;grid-template-columns:repeat(5,1fr);height:calc(68px + env(safe-area-inset-bottom));padding:7px 7px env(safe-area-inset-bottom);border-top:1px solid #2b342e;background:#0b0f0df5;backdrop-filter:blur(18px)}.mobile-nav a{display:flex;min-width:0;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:#89928b;border:0;background:transparent;font-size:8px;font-weight:800}.mobile-nav a.active{color:var(--accent)}.mobile-nav b{font-size:18px;line-height:1}.install.show{display:inline-flex}}
    @media(max-width:520px){header .outline{padding:0 11px}.brand{gap:8px}.logo{width:34px;height:38px}.heading{align-items:start;flex-direction:column}.heading h2{font-size:34px}.heading-actions{width:100%;align-items:stretch;flex-direction:column-reverse}.heading-actions .primary{width:100%}.tabs{display:grid;grid-template-columns:1fr 1fr}.dashboard{margin-top:26px}.chart-card{padding:18px}.chart-head{align-items:start;flex-direction:column}.chart-head aside{text-align:left}.growth-chart{height:145px}.metric-stack{grid-template-columns:1fr}.grid{gap:11px}.visual{padding:9px}.grade{right:6px;top:6px;font-size:6px}.quantity{left:6px;top:6px;font-size:6px}.card-info{padding:11px 9px}.card-info h3{font-size:12px}.price-tag{position:static;align-items:start;margin-top:9px}.meta{display:none}.formula{grid-template-columns:1fr}.formula>div+div{border-top:1px solid var(--line);border-left:0}.comp-card{padding:14px}.price-row{grid-template-columns:1fr 105px}.price-row button{grid-column:1/-1}.future h2{font-size:46px}.backdrop{padding:0;place-items:end center}.modal{max-height:92vh;border-radius:17px 17px 0 0}.modal-copy{padding:48px 24px 30px}.modal-copy h2{font-size:36px}.manual-form{grid-template-columns:1fr}.field.full,.form-actions{grid-column:1}.photo-pair{flex-direction:column}.form-actions{align-items:stretch;flex-direction:column-reverse}.modal-visual .card-art{width:190px}.scan-result,.detail-grid{grid-template-columns:1fr}.actions{flex-direction:column}}
    body[data-page="reset-password"] .reset-page{display:grid}.reset-help{margin-top:4px!important;color:var(--muted)!important}.reset-success{color:var(--accent)!important}.forgot-button{margin-top:8px}
  </style>
</head>
<body data-page="${route}">
  <header><a class="brand" href="/"><span class="logo" aria-hidden="true"><i></i><b></b></span>The Database</a><nav><a href="/" class="${route==='home'?'active':''}">Home</a><a href="/collection" class="${route==='collection'?'active':''}">Collection</a><a href="/pricing" class="${route==='pricing'?'active':''}">Pricing</a><a href="/scan" class="${route==='scan'?'active':''}">Scan</a><a href="/account" class="${route==='account'?'active':''}">Account</a></nav><div class="header-actions"><span class="sync-status hidden" id="syncStatus"></span><a class="outline" href="/account" id="accountLink">Sign in</a></div></header>
  <main>
    <section class="hero route-section home-page"><p class="kicker">YOUR SPORTS CARD DATABASE</p><div class="hero-row"><div><h1>Every card.<br><em>One database.</em></h1><p class="hero-copy">Organize your collection, set your own prices, and see how its value changes over time.</p><span class="app-badge">Protected. Organized. Yours.</span></div><aside class="stats"><div><small>COLLECTION VALUE</small><strong id="portfolio">Not priced</strong><span id="pricedCount">Set prices anytime</span></div><div><small>TOTAL CARDS</small><strong id="cardTotal">0 cards</strong><span>Includes duplicates</span></div></aside></div><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="homeSearch" placeholder="Search your collection…" aria-label="Search collection"><kbd>Enter</kbd></label><section class="dashboard" aria-label="Collection dashboard"><div class="chart-card"><div class="chart-head"><div><p class="kicker">VALUE HISTORY</p><h2>Collection growth</h2></div><aside><strong id="growthValue">$0.00</strong><small id="growthLabel">Set prices to begin tracking</small></aside></div><svg class="growth-chart" id="growthChart" viewBox="0 0 700 180" preserveAspectRatio="none" aria-label="Collection value history chart"><path class="chart-grid" d="M0 20H700M0 90H700M0 160H700"/><path class="growth-area" id="growthArea" d="M0 160H700V160H0Z"/><path class="growth-line" id="growthLine" d="M0 160L700 160"/></svg></div><div class="metric-stack"><div class="metric-card"><small>AVERAGE CARD VALUE</small><strong id="averageValue">—</strong><span id="averageLabel">No prices set</span></div><div class="metric-card"><small>PRICING COVERAGE</small><strong id="coverageValue">0%</strong><span id="coverageLabel">No cards</span><div class="progress"><i id="coverageBar"></i></div></div><div class="metric-card"><small>TOTAL SPENT</small><strong id="costBasis">—</strong><span id="costLabel">Add purchase prices</span></div><div class="metric-card"><small>ESTIMATED PROFIT</small><strong id="profitValue">—</strong><span id="profitLabel">Value minus cost</span></div></div></section></section>
    <section class="catalog route-section collection-page"><div class="heading"><div><p class="kicker">COLLECTION</p><h2>Cards in your collection</h2></div><div class="heading-actions"><small id="count"></small><button class="primary" id="addCard">＋ Add card manually</button></div></div><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="search" placeholder="Search by player, set, team, or parallel…" aria-label="Search collection"></label><div class="filters"><div class="tabs" id="tabs"><button class="active" data-sport="All">All</button><button data-sport="Baseball">Baseball</button><button data-sport="Basketball">Basketball</button><button data-sport="Football">Football</button></div><div class="selects"><select id="setFilter" aria-label="Filter by set"><option>All sets</option></select><select id="containerFilter" aria-label="Filter by container"><option>All locations</option></select><select id="sort" aria-label="Sort cards"><option>Recently added</option><option>Player A–Z</option></select></div></div><div class="grid" id="grid"></div><div class="empty hidden" id="empty"><h3>No cards found</h3><p>Try another player or clear the filters.</p><button class="primary" id="clear">Clear filters</button></div></section>
    <section class="pricing route-section pricing-page"><div class="pricing-copy"><p class="kicker">MANUAL PRICING</p><h2>Your cards.<br><em>Your prices.</em></h2><p>Set the value you believe each card is worth. Prices are saved on this device until automatic verified pricing is ready.</p><small class="success">Manual prices are clearly labeled and can be changed anytime.</small></div><div class="comp-card"><div class="price-list" id="priceList"></div></div></section>
    <section class="future route-section scan-page"><div class="future-copy"><p class="kicker">${env.OPENAI_API_KEY ? "CARD SCANNER" : "CARD PHOTOS"}</p><h2>${env.OPENAI_API_KEY ? "Point. Scan.<br><em>Catalog.</em>" : "Snap it.<br><em>Save it.</em>"}</h2><p>${env.OPENAI_API_KEY ? "Photograph the front and back. The scanner suggests the card details, then you confirm them before anything is saved." : "Photograph the front and back, or pick photos you already took, then fill in the details yourself. Automatic recognition is coming later."}</p><button class="outline install" id="installApp">Install The Database</button></div><button class="scan-card" id="scanCard"><div><p class="kicker">${env.OPENAI_API_KEY ? "AI-ASSISTED CAPTURE" : "PHOTO CAPTURE"}</p><h3>${env.OPENAI_API_KEY ? "Scan a card." : "Add a card with photos."}</h3><p>${env.OPENAI_API_KEY ? "Use your phone camera or photo library. A back photo is optional but improves card-number, set, and grading-label recognition." : "Use your camera, or choose a photo you already took. Front and back are both saved with the card."}</p><b>${env.OPENAI_API_KEY ? "Open scanner →" : "Add a card →"}</b></div><aside class="scanner"><i></i><div id="scanMini"></div><small>Tap to begin</small></aside></button><div class="tracking"><p class="kicker">${env.OPENAI_API_KEY ? "REVIEW BEFORE SAVING" : "YOUR PHOTOS, YOUR COLLECTION"}</p><div class="tracking-head"><h3>You stay in control.</h3></div><p class="modal-sub">${env.OPENAI_API_KEY ? "Recognition can confuse similar parallels and variations. Every suggested field remains editable, and prices are still entered manually." : "Photos are stored privately with your card and only you can see them. Nothing is saved until you choose Add to collection."}</p></div></section>
    <section class="account-page route-section"><div class="account-shell"><div id="signedOut"><p class="kicker">COLLECTOR ACCOUNT</p><h1>Keep your cards everywhere.</h1><p>Create an account to sync your collection and photos between your phone and computer.</p><form class="auth-form" id="authForm"><input class="hidden" name="displayName" placeholder="Display name" autocomplete="name"><input name="email" type="email" required placeholder="Email address" autocomplete="email"><input name="password" type="password" required minlength="6" placeholder="Password" autocomplete="current-password"><button class="primary" type="submit">Sign in</button></form><button class="auth-switch forgot-button" id="forgotPassword" type="button">Forgot password?</button><button class="auth-switch" id="authSwitch" type="button">New here? Create an account</button><p class="auth-message" id="authMessage"></p></div><div class="hidden" id="signedIn"><span class="cloud-badge">Cloud sync active</span><h1 id="accountName">Your account</h1><p id="accountEmail"></p><div class="account-actions"><button class="primary" id="migrateCards" type="button">Move device cards to my account</button><a class="outline" href="/collection">Open cloud collection</a><button class="outline" id="exportCollection" type="button">Export my collection</button><button class="outline" id="signOut" type="button">Sign out</button></div><p class="auth-message" id="syncPending"></p><p class="auth-message" id="syncMessage"></p></div></div></section>
    <section class="account-page reset-page route-section"><div class="account-shell"><p class="kicker">PASSWORD RECOVERY</p><h1>Choose a new password.</h1><p class="reset-help">Enter a new password for your collector account.</p><form class="auth-form" id="resetForm"><input name="password" type="password" required minlength="8" placeholder="New password" autocomplete="new-password"><input name="confirmPassword" type="password" required minlength="8" placeholder="Confirm new password" autocomplete="new-password"><button class="primary" type="submit">Update password</button></form><p class="auth-message" id="resetMessage"></p><a class="outline hidden" id="returnToSignIn" href="/account">Return to sign in</a></div></section>
  </main>
  <footer><a class="brand" href="/"><span class="logo" aria-hidden="true"><i></i><b></b></span>The Database</a><p>SPORTS CARD COLLECTION · PRIVATE COLLECTIONS</p></footer>
  <nav class="mobile-nav" aria-label="App navigation"><a href="/" class="${route==='home'?'active':''}"><b>⌂</b>Home</a><a href="/collection" class="${route==='collection'?'active':''}"><b>▦</b>Collection</a><a href="/pricing" class="${route==='pricing'?'active':''}"><b>$</b>Pricing</a><a href="/scan" class="${route==='scan'?'active':''}"><b>◎</b>Scan</a><a href="/account" class="${route==='account'?'active':''}"><b>●</b>Account</a></nav>
  <div class="backdrop" id="backdrop"><section class="modal" id="modal"></section></div>
  <script>
    const SUPABASE_URL=${JSON.stringify(env.SUPABASE_URL || env.supabase_url || "")},SUPABASE_KEY=${JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY || env.supabase_publishable_key || "")},SCAN_AI=${env.OPENAI_API_KEY ? "true" : "false"},APP_VERSION=${JSON.stringify(VERSION)};
    const previewCard={id:'preview',player:'Your Card',year:'—',set:'The Database',number:'—',parallel:'Ready to scan',sport:'Other',grade:'Raw',team:'',initials:'DB',color:'blue'};
    let customCards=[];try{customCards=JSON.parse(localStorage.getItem('the-database-cards')||'[]')}catch(e){}
    // One-time upgrade: prices used to live in a map keyed by card id, parallel to
    // the cards themselves. That split was the source of several bugs, so fold any
    // surviving entries onto the cards and drop the map for good. Cloud cards need
    // nothing here: their price comes from the row.
    (function(){let legacy={};try{legacy=JSON.parse(localStorage.getItem('the-database-prices')||'{}')}catch(e){}
      if(!Object.keys(legacy).length)return;
      customCards=customCards.map(c=>c.currentValue===undefined&&Number(legacy[c.id])>0?Object.assign({},c,{currentValue:Number(legacy[c.id])}):c);
      localStorage.setItem('the-database-cards',JSON.stringify(customCards));
      localStorage.removeItem('the-database-prices');
    })();
    // Device cards saved before locations were structured: split what was typed
    // into the three fields, mirroring the SQL migration for cloud cards. The
    // original text is left in place so a bad split can be traced back.
    const parseLegacyLocation = text => {let parts=String(text||'').replace(/,/g,'/').split('/').map(v=>v.trim()).filter(Boolean);return{container:parts[0]||'',section:parts[1]||'',slot:parts.slice(2).join(' / ')}};
    (function(){
      let changed=false;
      customCards=customCards.map(c=>{
        if(c.container!==undefined||!String(c.location||'').trim())return c;
        changed=true;
        return Object.assign({},c,parseLegacyLocation(c.location));
      });
      if(changed)localStorage.setItem('the-database-cards',JSON.stringify(customCards));
    })();
    const buildCards = () => customCards.slice();
    let cards=buildCards();
    const readDeviceCards = () => {try{return JSON.parse(localStorage.getItem('the-database-cards')||'[]')}catch(e){return[]}};
    const persistDeviceCards = () => {if(!session)localStorage.setItem('the-database-cards',JSON.stringify(customCards))};
    let lastPhotoSign=0;
    const $ = s => document.querySelector(s);
    const safe = value => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const money = n => (Number(n)<0?'-$':'$') + Math.abs(Number(n)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    const CARD_COLORS=['blue','red','gold','orange','purple','silver'];
    const initialsFor = name => String(name??'').trim().split(/\\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
    const colorFor = id => {let s=String(id),h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return CARD_COLORS[h%CARD_COLORS.length]};
    let valueHistory=[];try{valueHistory=JSON.parse(localStorage.getItem('the-database-history')||'[]')}catch(e){}
    let session=null;try{session=JSON.parse(localStorage.getItem('the-database-session')||'null')}catch(e){}
    const authHeaders=()=>({'apikey':SUPABASE_KEY,'Authorization':'Bearer '+(session?session.access_token:SUPABASE_KEY)});
    // Error reporting. Records no card data, only what broke and where. Bounded
    // hard: it never throws, never blocks the UI, never reports the same thing
    // twice, and stops after ERROR_REPORT_LIMIT so a failure loop cannot flood
    // the table or the network. Reporting is itself guarded so a failure inside
    // reportError cannot re-enter through the global handlers.
    const ERROR_REPORT_LIMIT=10;
    let errorReportCount=0,reportingError=false;
    const reportedErrors=new Set();
    async function reportError(context,error){
      try{
        if(!session||reportingError||errorReportCount>=ERROR_REPORT_LIMIT)return;
        let message=String(error&&error.message||error||'').slice(0,500);
        if(!message)return;
        let key=context+'|'+message;
        if(reportedErrors.has(key))return;
        reportedErrors.add(key);
        errorReportCount++;
        reportingError=true;
        try{
          await fetch(SUPABASE_URL+'/rest/v1/error_events',{method:'POST',headers:Object.assign({'Content-Type':'application/json','Prefer':'return=minimal'},authHeaders()),body:JSON.stringify({user_id:session.user.id,context:String(context).slice(0,80),message,detail:String(error&&error.stack||'').slice(0,2000),user_agent:String(navigator.userAgent||'').slice(0,300),app_version:APP_VERSION})});
        }finally{reportingError=false}
      }catch(e){}
    }
    async function sb(path,options){if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error('Account service is not configured yet.');let response=await fetch(SUPABASE_URL+path,Object.assign({},options||{},{headers:Object.assign({'apikey':SUPABASE_KEY,'Authorization':'Bearer '+(session?session.access_token:SUPABASE_KEY),'Content-Type':'application/json'},options&&options.headers||{})}));let text=await response.text(),data=null;try{data=text?JSON.parse(text):null}catch(e){if(!response.ok)throw new Error(text||'Request failed')}if(!response.ok)throw new Error(data&&((data.msg)||(data.message)||(data.error_description))||text||'Request failed');return data}
    const rowToCard=r=>({id:r.id,player:r.player,year:r.year||'',sport:r.sport||'Other',set:r.card_set||'',number:r.card_number||'—',team:r.team||'',parallel:r.parallel||'Base',grade:r.grade||'Raw',quantity:r.quantity||1,purchasePrice:Number(r.purchase_price)||0,purchaseDate:r.purchase_date||'',location:r.storage_location||'',container:r.storage_container||'',section:r.storage_section||'',slot:r.storage_slot||'',collectionStatus:r.collection_status||'Personal collection',notes:r.notes||'',photo:null,photoBack:null,frontImagePath:r.front_image_path||null,backImagePath:r.back_image_path||null,initials:initialsFor(r.player),color:colorFor(r.id),createdAt:r.created_at||'',currentValue:Number(r.current_value)||0});
    const cardToRow=c=>({id:String(c.id),user_id:session.user.id,player:c.player,year:Number(c.year)||null,sport:c.sport,card_set:c.set,card_number:c.number,team:c.team,parallel:c.parallel,grade:c.grade,quantity:qty(c),purchase_price:Number(c.purchasePrice)||null,purchase_date:c.purchaseDate||null,current_value:cardPrice(c),storage_location:c.location||null,storage_container:c.container||null,storage_section:c.section||null,storage_slot:c.slot||null,collection_status:c.collectionStatus||'Personal collection',notes:c.notes||null,front_image_path:c.frontImagePath||null,back_image_path:c.backImagePath||null,visibility:'private',listing_status:'not_listed'});
    function dataUrlBlob(data){let parts=data.split(','),mime=parts[0].match(/:(.*?);/)[1],bytes=atob(parts[1]),array=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);return new Blob([array],{type:mime})}
    async function uploadCardPhoto(c,side){let data=side==='back'?c.photoBack:c.photo;if(!data||!data.startsWith('data:'))return side==='back'?c.backImagePath:c.frontImagePath;let path=session.user.id+'/'+c.id+'-'+side+'.jpg',response=await fetch(SUPABASE_URL+'/storage/v1/object/card-photos/'+path,{method:'POST',headers:Object.assign(authHeaders(),{'Content-Type':'image/jpeg','x-upsert':'true'}),body:dataUrlBlob(data)});if(!response.ok)throw new Error('Photo upload failed');return path}
    async function cloudSaveCard(c){if(!session)return;c.frontImagePath=await uploadCardPhoto(c,'front');c.backImagePath=await uploadCardPhoto(c,'back');await sb('/rest/v1/cards?on_conflict=id',{method:'POST',headers:{'Prefer':'resolution=merge-duplicates'},body:JSON.stringify(cardToRow(c))})}
    // Photo URLs are signed, not public, so every image needs a round-trip before
    // it can be shown. Signing them one at a time blocked the whole collection
    // from rendering, so they are cached for their lifetime and signed in bulk.
    const SIGNED_KEY='the-database-signed',SIGNED_TTL=7200,SIGNED_SAFE=6600*1000;
    let signedCache={};
    try{
      signedCache=JSON.parse(localStorage.getItem(SIGNED_KEY)||'{}');
      let now=Date.now();
      Object.keys(signedCache).forEach(k=>{if(!signedCache[k]||signedCache[k].expires<now)delete signedCache[k]});
    }catch(e){signedCache={}}
    function saveSignedCache(){try{localStorage.setItem(SIGNED_KEY,JSON.stringify(signedCache))}catch(e){}}
    const cachedSignedUrl = path => {let hit=signedCache[path];return hit&&hit.expires>Date.now()?hit.url:null};
    async function inBatches(items,size,fn){let out=[];for(let i=0;i<items.length;i+=size)out=out.concat(await Promise.all(items.slice(i,i+size).map(fn)));return out}
    async function signPaths(paths){
      let wanted=[...new Set(paths.filter(Boolean))],out={},missing=[];
      wanted.forEach(p=>{let hit=cachedSignedUrl(p);if(hit)out[p]=hit;else missing.push(p)});
      if(!missing.length)return out;
      try{
        // One request for the lot. Falls through to individual signing if the
        // project does not answer this shape.
        let res=await sb('/storage/v1/object/sign/card-photos',{method:'POST',body:JSON.stringify({expiresIn:SIGNED_TTL,paths:missing})});
        if(Array.isArray(res)&&res.length){
          res.forEach(r=>{if(r&&r.path&&r.signedURL)out[r.path]=SUPABASE_URL+'/storage/v1'+r.signedURL});
          if(Object.keys(out).length>=missing.length){
            missing.forEach(p=>{if(out[p])signedCache[p]={url:out[p],expires:Date.now()+SIGNED_SAFE}});
            saveSignedCache();
            return out;
          }
        }
      }catch(e){}
      let signed=await inBatches(missing.filter(p=>!out[p]),12,async p=>{try{return [p,await signedPhoto(p)]}catch(e){return [p,null]}});
      signed.forEach(([p,url])=>{if(url){out[p]=url;signedCache[p]={url,expires:Date.now()+SIGNED_SAFE}}});
      saveSignedCache();
      return out;
    }
    async function attachPhotos(list){
      let urls=await signPaths(list.flatMap(c=>[c.frontImagePath,c.backImagePath]));
      list.forEach(c=>{c.photo=urls[c.frontImagePath]||null;c.photoBack=urls[c.backImagePath]||null});
      lastPhotoSign=Date.now();
      render();
    }
    async function signedPhoto(path){if(!path)return null;let d=await sb('/storage/v1/object/sign/card-photos/'+path,{method:'POST',body:JSON.stringify({expiresIn:7200})});return SUPABASE_URL+'/storage/v1'+d.signedURL}
    async function loadCloudCards(){let rows=await sb('/rest/v1/cards?select=*&order=created_at.desc'),loaded=rows.map(rowToCard);loaded.forEach(c=>{c.photo=cachedSignedUrl(c.frontImagePath);c.photoBack=cachedSignedUrl(c.backImagePath)});customCards=loaded;cards=customCards;render();renderPricing();refreshSets();updateTotals();await attachPhotos(loaded)}
    async function deleteStoredPhoto(path){if(!path)return;try{await fetch(SUPABASE_URL+'/storage/v1/object/card-photos/'+path,{method:'DELETE',headers:authHeaders()})}catch(e){}}
    async function deleteCloudCard(c){if(!session)return;await sb('/rest/v1/cards?id=eq.'+encodeURIComponent(c.id),{method:'DELETE'});await deleteStoredPhoto(c.frontImagePath);await deleteStoredPhoto(c.backImagePath)}
    async function refreshPhotoUrls(){if(!session)return;try{[...new Set(customCards.flatMap(c=>[c.frontImagePath,c.backImagePath]).filter(Boolean))].forEach(p=>{delete signedCache[p]});saveSignedCache();await attachPhotos(customCards)}catch(e){}}
    // ---- Value history ---------------------------------------------------
    // Kept server-side so the growth chart follows a collector between devices.
    // Deliberately best-effort rather than queued through the outbox: a snapshot
    // is one point on a trend line, so losing one costs a little smoothness,
    // while a card is the collector's actual data and must never be dropped.
    const SNAPSHOT_LIMIT=200,SNAPSHOT_DEBOUNCE=30000;
    let snapshotTimer=null;
    function scheduleSnapshotSync(){
      if(!session)return;
      // A burst of price edits should leave one point, not one per keystroke.
      clearTimeout(snapshotTimer);
      snapshotTimer=setTimeout(()=>{snapshotTimer=null;pushSnapshot()},SNAPSHOT_DEBOUNCE);
    }
    async function pushSnapshot(){
      if(!session)return;
      try{await sb('/rest/v1/collection_snapshots',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify({user_id:session.user.id,total:collectionTotal()})})}
      catch(err){reportError('snapshot-write',err)}
    }
    async function loadCloudHistory(){
      if(!session)return;
      try{
      let rows=await sb('/rest/v1/collection_snapshots?select=total,created_at&order=created_at.asc&limit='+SNAPSHOT_LIMIT);
      // First sign-in on a device that already has a chart: carry it up rather
      // than throwing away history the collector can see today.
      if(!rows.length&&valueHistory.length){
        try{
          await sb('/rest/v1/collection_snapshots',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify(valueHistory.map(h=>({user_id:session.user.id,total:h.total,created_at:new Date(h.time).toISOString()})))});
          rows=valueHistory.map(h=>({total:h.total,created_at:new Date(h.time).toISOString()}));
        }catch(err){reportError('snapshot-upload',err);return}
      }
      valueHistory=rows.map(r=>({time:new Date(r.created_at).getTime(),total:Number(r.total)||0}));
      localStorage.setItem('the-database-history',JSON.stringify(valueHistory));
      updateTotals();
      }catch(err){reportError('snapshot-read',err)}
    }
    // ---- Outbox ---------------------------------------------------------
    // Every cloud mutation is recorded here before it is attempted, so a save
    // survives a refresh, a dead connection, or a failed request. Signed-out
    // users have no outbox: localStorage is already their store of record.
    const OUTBOX_KEY='the-database-outbox',OUTBOX_MAX=200;
    let outbox=[];try{outbox=JSON.parse(localStorage.getItem(OUTBOX_KEY)||'[]')}catch(e){}
    let flushing=false,flushTimer=null,lastSyncError='',syncedUntil=0;
    function saveOutbox(){try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(outbox));return true}catch(err){lastSyncError='This device is out of space for pending changes. Free some space and reload.';reportError('outbox-quota',err);return false}}
    function enqueue(op){
      // A newer operation for a card replaces whatever was still pending for it,
      // so a delete supersedes an unsent save and repeated edits collapse to one.
      outbox=outbox.filter(o=>String(o.cardId)!==String(op.cardId));
      outbox.push(op);
      if(outbox.length>OUTBOX_MAX)outbox=outbox.slice(-OUTBOX_MAX);
      saveOutbox();renderSyncStatus();flushOutbox();
    }
    const queueSave = card => enqueue({kind:'save',cardId:String(card.id),card,queuedAt:Date.now(),attempts:0});
    const queueDelete = card => enqueue({kind:'delete',cardId:String(card.id),card:{id:card.id,frontImagePath:card.frontImagePath||null,backImagePath:card.backImagePath||null},queuedAt:Date.now(),attempts:0});
    function scheduleFlush(){
      if(flushTimer||!outbox.length)return;
      let attempts=outbox[0].attempts||0,delay=Math.min(60000,2000*Math.pow(2,Math.min(attempts,5)));
      flushTimer=setTimeout(()=>{flushTimer=null;flushOutbox()},delay);
    }
    async function flushOutbox(){
      if(flushing||!session||!outbox.length)return;
      if(navigator.onLine===false){renderSyncStatus();scheduleFlush();return}
      flushing=true;renderSyncStatus();
      try{
        while(outbox.length){
          let op=outbox[0];
          try{
            if(op.kind==='delete')await deleteCloudCard(op.card);
            else{
              await cloudSaveCard(op.card);
              // Photo paths are assigned during upload; carry them back so the
              // live card is not re-uploading the same images next time.
              let live=customCards.find(c=>String(c.id)===op.cardId);
              if(live){live.frontImagePath=op.card.frontImagePath;live.backImagePath=op.card.backImagePath}
            }
            outbox.shift();lastSyncError='';saveOutbox();renderSyncStatus();
          }catch(err){
            op.attempts=(op.attempts||0)+1;
            op.lastError=String(err&&err.message||err);
            lastSyncError=op.lastError;
            saveOutbox();
            reportError('sync-'+op.kind,err);
            break; // Stop rather than reorder: later edits may depend on earlier ones.
          }
        }
        if(!outbox.length)syncedUntil=Date.now()+4000;
      }finally{flushing=false;renderSyncStatus();scheduleFlush()}
    }
    function renderSyncStatus(){
      let el=$('#syncStatus');if(!el)return;
      let pending=outbox.length;
      if(!session||(!pending&&Date.now()>syncedUntil)){el.className='sync-status hidden';return}
      let state,text;
      if(!pending){state='ok';text='Synced';}
      else if(navigator.onLine===false){state='offline';text=pending+' offline';}
      else if(flushing){state='pending';text='Saving '+pending;}
      else if(lastSyncError){state='error';text=pending+' unsaved';}
      else{state='pending';text=pending+' pending';}
      let detail=$('#syncPending');
      if(detail)detail.textContent=pending?(pending+' change'+(pending===1?'':'s')+' still to sync'+(lastSyncError?': '+lastSyncError:'. Retrying automatically.')):'';
      el.className='sync-status '+state;
      el.innerHTML='<span>'+safe(text)+'</span>';
      el.title=lastSyncError||'';
    }
    // Minimal store-only ZIP writer. Photos are already JPEG, so skipping
    // compression costs nothing and keeps this dependency-free.
    const CRC_TABLE=(()=>{let t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0}return t})();
    function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
    function zipStore(entries){
      let encoder=new TextEncoder(),parts=[],central=[],offset=0,count=0,now=new Date();
      let dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
      let dosDate=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
      for(let entry of entries){
        let name=encoder.encode(entry.name),data=entry.data,sum=crc32(data);
        let local=new DataView(new ArrayBuffer(30));
        local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0,true);local.setUint16(8,0,true);
        local.setUint16(10,dosTime,true);local.setUint16(12,dosDate,true);
        local.setUint32(14,sum,true);local.setUint32(18,data.length,true);local.setUint32(22,data.length,true);
        local.setUint16(26,name.length,true);local.setUint16(28,0,true);
        parts.push(new Uint8Array(local.buffer),name,data);
        let dir=new DataView(new ArrayBuffer(46));
        dir.setUint32(0,0x02014b50,true);dir.setUint16(4,20,true);dir.setUint16(6,20,true);dir.setUint16(8,0,true);
        dir.setUint16(10,0,true);dir.setUint16(12,dosTime,true);dir.setUint16(14,dosDate,true);
        dir.setUint32(16,sum,true);dir.setUint32(20,data.length,true);dir.setUint32(24,data.length,true);
        dir.setUint16(28,name.length,true);dir.setUint16(30,0,true);dir.setUint16(32,0,true);
        dir.setUint16(34,0,true);dir.setUint16(36,0,true);dir.setUint32(38,0,true);dir.setUint32(42,offset,true);
        central.push(new Uint8Array(dir.buffer),name);
        offset+=30+name.length+data.length;count++;
      }
      let dirSize=central.reduce((n,p)=>n+p.length,0);
      let end=new DataView(new ArrayBuffer(22));
      end.setUint32(0,0x06054b50,true);end.setUint16(4,0,true);end.setUint16(6,0,true);
      end.setUint16(8,count,true);end.setUint16(10,count,true);
      end.setUint32(12,dirSize,true);end.setUint32(16,offset,true);end.setUint16(20,0,true);
      return new Blob(parts.concat(central,[new Uint8Array(end.buffer)]),{type:'application/zip'});
    }
    async function photoBytes(src){
      if(String(src).startsWith('data:'))return new Uint8Array(await dataUrlBlob(src).arrayBuffer());
      let response=await fetch(src);
      if(!response.ok)throw new Error('photo unavailable');
      return new Uint8Array(await response.arrayBuffer());
    }
    const EXPORT_COLUMNS=['id','player','year','sport','set','number','team','parallel','grade','quantity','currentValue','purchasePrice','purchaseDate','storageLocation','collectionStatus','notes','frontPhoto','backPhoto'];
    const csvCell = value => '"'+String(value??'').split('"').join('""')+'"';
    async function exportCollection(){
      let button=$('#exportCollection'),label='Export my collection',message=$('#syncMessage'),NL=String.fromCharCode(13,10);
      let list=cards.slice();
      message.classList.remove('reset-success');
      if(!list.length){message.textContent='There are no cards to export yet.';return}
      button.disabled=true;
      try{
        let rows=list.map(c=>({id:String(c.id),player:c.player,year:c.year,sport:c.sport,set:c.set,number:c.number,team:c.team,parallel:c.parallel,grade:c.grade,quantity:qty(c),currentValue:cardPrice(c)||'',purchasePrice:Number(c.purchasePrice)||0,purchaseDate:c.purchaseDate||'',storageLocation:c.location||'',collectionStatus:c.collectionStatus||'',notes:c.notes||'',frontPhoto:'',backPhoto:''})),photos=[],missing=0;
        for(let i=0;i<list.length;i++){
          button.textContent='Collecting photos '+(i+1)+' of '+list.length+'…';
          for(let side of ['front','back']){
            let src=side==='back'?list[i].photoBack:list[i].photo;
            if(!src)continue;
            try{
              let name='photos/'+rows[i].id+'-'+side+'.jpg';
              photos.push({name,data:await photoBytes(src)});
              rows[i][side==='back'?'backPhoto':'frontPhoto']=name;
            }catch(e){missing++}
          }
        }
        button.textContent='Building your file…';
        let manifest={app:'The Database',exportVersion:1,exportedAt:new Date().toISOString(),account:session?session.user.email:null,source:session?'cloud':'device',cardCount:rows.length,photoCount:photos.length,photosUnavailable:missing,cards:rows};
        let csv=[EXPORT_COLUMNS.map(csvCell).join(',')].concat(rows.map(r=>EXPORT_COLUMNS.map(k=>csvCell(r[k])).join(','))).join(NL);
        let notes=['The Database — collection export','','Exported: '+manifest.exportedAt,'Cards: '+manifest.cardCount,'Photos: '+manifest.photoCount,'','collection.json  Complete records, best for restoring or moving your data.','collection.csv   Same cards as a spreadsheet.','photos/          Front and back images, named by card id.','','Keep this file somewhere safe. It is a complete copy of your collection.'].join(NL);
        let encoder=new TextEncoder();
        let blob=zipStore([{name:'collection.json',data:encoder.encode(JSON.stringify(manifest,null,2))},{name:'collection.csv',data:encoder.encode(csv)},{name:'README.txt',data:encoder.encode(notes)}].concat(photos));
        let url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='the-database-export-'+new Date().toISOString().slice(0,10)+'.zip';
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
        message.textContent='Exported '+rows.length+' card'+(rows.length===1?'':'s')+' and '+photos.length+' photo'+(photos.length===1?'':'s')+'.'+(missing?' '+missing+' photo'+(missing===1?'':'s')+' could not be downloaded and were left out.':'');
        if(!missing)message.classList.add('reset-success');
      }catch(err){reportError('export',err);message.textContent='The export could not be completed: '+(err&&err.message||'unknown error');}
      button.disabled=false;button.textContent=label;
    }
    const qty = c => Math.max(1,Number(c.quantity)||1);
    const cardPrice = c => Number(c.currentValue)>0?Number(c.currentValue):null;
    const collectionTotal = () => cards.reduce((total,c)=>total+(cardPrice(c)||0)*qty(c),0);
    function recordSnapshot(){const total=collectionTotal(),last=valueHistory[valueHistory.length-1];if(!last||Math.abs(last.total-total)>.001){valueHistory.push({time:Date.now(),total});valueHistory=valueHistory.slice(-40);localStorage.setItem('the-database-history',JSON.stringify(valueHistory));scheduleSnapshotSync()}}
    
    function chartPath(){let points=valueHistory.slice(-20);if(!points.length)points=[{total:0},{total:0}];if(points.length===1)points=[points[0],points[0]];const vals=points.map(p=>p.total),min=Math.min(...vals),max=Math.max(...vals),range=Math.max(max-min,1);return points.map((p,i)=>{const x=i/(points.length-1)*700,y=160-((p.total-min)/range)*130;return [x,y]}).map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join('')}
    function updateTotals(){const priced=cards.filter(c=>cardPrice(c)!==null),total=collectionTotal(),units=cards.reduce((n,c)=>n+qty(c),0),cost=cards.reduce((n,c)=>n+(Number(c.purchasePrice)||0)*qty(c),0),coverage=cards.length?Math.round(priced.length/cards.length*100):0,baseline=valueHistory.length?valueHistory[0].total:total,growth=total-baseline,profit=total-cost,path=chartPath();$('#portfolio').textContent=priced.length?money(total):'Not priced';$('#pricedCount').textContent=cards.length?priced.length+' of '+cards.length+' entries priced':'Collection is empty';$('#cardTotal').textContent=units+' card'+(units===1?'':'s');$('#averageValue').textContent=priced.length?money(total/priced.reduce((n,c)=>n+qty(c),0)):'—';$('#averageLabel').textContent=priced.length?'Per priced card':'No prices set';$('#coverageValue').textContent=coverage+'%';$('#coverageLabel').textContent=cards.length?priced.length+' of '+cards.length+' entries':'No cards';$('#coverageBar').style.width=coverage+'%';$('#costBasis').textContent=cost?money(cost):'—';$('#costLabel').textContent=cost?'Recorded purchase cost':'Add purchase prices';$('#profitValue').textContent=cost&&priced.length?(profit>=0?'+':'')+money(profit):'—';$('#profitValue').style.color=profit<0?'#ff7b7b':'var(--accent)';$('#profitLabel').textContent=cost?'Current value minus cost':'Value minus cost';$('#growthValue').textContent=(growth>0?'+':'')+money(growth);$('#growthValue').style.color=growth<0?'#ff7b7b':'var(--accent)';$('#growthLabel').textContent=valueHistory.length>1?'Since '+new Date(valueHistory[0].time).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Change prices to track growth';$('#growthLine').setAttribute('d',path);$('#growthArea').setAttribute('d',path+'L700 160L0 160Z')}
    const art = (c,mini,side) => {let photo=side==='back'?c.photoBack:c.photo;return photo?'<div class="card-art has-photo'+(mini?' mini':'')+'"><img class="card-photo" loading="lazy" decoding="async" src="'+safe(photo)+'" alt="'+safe(c.player)+' card '+(side==='back'?'back':'front')+'"></div>':'<div class="card-art '+safe(c.color)+(mini?' mini':'')+'"><span class="card-year">'+safe(c.year)+'</span><span class="card-set">'+safe(c.set.split(' ')[0])+'</span><div class="orbit"></div><strong class="initials">'+safe(c.initials)+'</strong><section class="art-name"><b>'+safe(c.player)+'</b><small>'+safe(c.parallel)+'</small></section><em class="card-num">'+safe(c.number)+'</em></div>'};
    const ebay = c => 'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(c.year+' '+c.set+' '+c.player+' '+c.number+' '+c.parallel+' '+c.grade)+'&LH_Sold=1&LH_Complete=1';
    let sport='All';
    function render(){let q=$('#search').value.toLowerCase().trim(), set=$('#setFilter').value, container=$('#containerFilter').value, sort=$('#sort').value;let list=cards.filter(c=>(!q||(c.player+' '+c.set+' '+c.parallel+' '+c.team+' '+locationText(c)+' '+(c.notes||'')+' '+(c.collectionStatus||'')).toLowerCase().includes(q))&&(sport==='All'||c.sport===sport)&&(set==='All sets'||c.set===set)&&(container==='All locations'||String(c.container||'').trim()===container));if(sort==='Player A–Z')list.sort((a,b)=>a.player.localeCompare(b.player));else list.sort((a,b)=>{let x=String(a.createdAt||''),y=String(b.createdAt||'');return x&&y?y.localeCompare(x):String(b.id).localeCompare(String(a.id))});$('#count').textContent=list.length+' of '+cards.length+' entries';$('#grid').innerHTML=list.map(c=>'<article class="catalog-card" tabindex="0" data-id="'+c.id+'"><div class="visual">'+art(c,false)+'<b class="grade">'+safe(c.grade)+'</b>'+(qty(c)>1?'<b class="quantity">×'+qty(c)+'</b>':'')+'</div><div class="card-info"><div><h3>'+safe(c.player)+'</h3><p>'+safe(c.year)+' · '+safe(c.set)+'</p></div><aside class="price-tag"><strong>'+(cardPrice(c)?money(cardPrice(c)*qty(c)):'Not priced')+'</strong><small>'+(cardPrice(c)?(qty(c)>1?'Total value':'Your price'):'Set your price')+'</small></aside><div class="meta"><span>'+safe(c.collectionStatus||c.parallel)+'</span><span>'+safe(c.number)+'</span></div></div></article>').join('');$('#grid').classList.toggle('hidden',!list.length);$('#empty').classList.toggle('hidden',!!list.length);document.querySelectorAll('.catalog-card').forEach(el=>{el.onclick=()=>openCard(cards.find(c=>String(c.id)===el.dataset.id));el.onkeydown=e=>{if(e.key==='Enter')el.click()}})}
    function openCard(c){let p=cardPrice(c),cost=(Number(c.purchasePrice)||0)*qty(c),value=(p||0)*qty(c),profit=value-cost;$('#modal').innerHTML='<button class="close" aria-label="Close">×</button><div class="modal-visual"><div class="detail-art">'+art(c,false)+'</div>'+(c.photoBack?'<button class="outline flip-photo" type="button">View back</button>':'')+'</div><div class="modal-copy"><p class="kicker">'+safe(c.sport)+' · '+safe(c.grade)+'</p><h2>'+safe(c.player)+'</h2><p class="modal-sub">'+safe(c.year)+' '+safe(c.set)+' · '+safe(c.parallel)+'</p><div class="value-box"><small>COLLECTION VALUE · '+qty(c)+' CARD'+(qty(c)===1?'':'S')+'</small><strong>'+(p?money(value):'Not priced')+'</strong><span>'+(cost&&p?((profit>=0?'+':'')+money(profit)+' estimated profit'):'Saved on this device')+'</span></div><div class="detail-grid"><div><small>Purchase price</small><b>'+(c.purchasePrice?money(c.purchasePrice)+' each':'Not entered')+'</b></div><div><small>Purchased</small><b>'+safe(c.purchaseDate||'Not entered')+'</b></div><div><small>Location</small><b>'+safe(locationText(c)||'Not entered')+'</b></div><div><small>Collection</small><b>'+safe(c.collectionStatus||'Uncategorized')+'</b></div></div>'+(c.notes?'<p class="detail-note">'+safe(c.notes)+'</p>':'')+'<div class="actions"><button class="primary edit-card" type="button">Edit card</button><a class="outline" target="_blank" rel="noreferrer" href="'+ebay(c)+'">Check eBay sold listings ↗</a></div><div class="actions"><button class="danger remove-card" type="button">Remove from collection</button></div><div class="remove-confirm"><p>Remove <b>'+safe(c.player)+'</b>? Its saved price and local photos will also be deleted.</p><div class="actions"><button class="outline cancel-remove" type="button">Cancel</button><button class="danger confirm-remove" type="button">Yes, remove card</button></div></div></div>';openModal();let side='front';if(c.photoBack){$('.flip-photo').onclick=()=>{side=side==='front'?'back':'front';$('.detail-art').innerHTML=art(c,false,side);$('.flip-photo').textContent=side==='front'?'View back':'View front'}}$('.edit-card').onclick=()=>openCardForm(c);$('.remove-card').onclick=()=>{$('.remove-confirm').classList.add('show');$('.remove-card').classList.add('hidden');$('.confirm-remove').focus()};$('.cancel-remove').onclick=()=>{$('.remove-confirm').classList.remove('show');$('.remove-card').classList.remove('hidden')};$('.confirm-remove').onclick=()=>removeCard(c)}
    async function removeCard(c){if(session)queueDelete(c);customCards=customCards.filter(x=>String(x.id)!==String(c.id));persistDeviceCards();cards=buildCards();recordSnapshot();refreshSets();render();renderPricing();updateTotals();closeModal()}
    function openScan(){
      let frontFile=null,backFile=null;
      $('#modal').innerHTML='<button class="close" aria-label="Close">×</button><div class="scan-stage"><div class="scan-frame" id="photoFrame">'+art(cards[1]||cards[0]||previewCard,false)+'<i></i><b class="scan-check">✓</b></div><small class="scan-status">READY TO CAPTURE</small></div><div class="modal-copy scan-copy"><p class="kicker">'+(SCAN_AI?'AI-ASSISTED CAPTURE':'PHOTO CAPTURE')+'</p><h2>Photograph your card.</h2><p class="modal-sub">'+(SCAN_AI?'Start with the front. Add the back or grading label for a stronger match.':'Add a front photo, and the back too if you want. Take a new one or choose a photo you already have.')+'</p><div class="scan-upload-grid"><button class="scan-upload" id="chooseFront" type="button"><b>＋</b><span>Front photo<br><small>Required</small></span></button><button class="scan-upload" id="chooseBack" type="button"><b>＋</b><span>Back / label<br><small>Optional</small></span></button></div><input class="hidden" id="scanFront" type="file" accept="image/*"><input class="hidden" id="scanBack" type="file" accept="image/*"><div class="scan-actions">'+(SCAN_AI?'<button class="primary" id="analyzeCard" type="button" disabled>Identify card</button><button class="outline" id="manualScan" type="button" disabled>Continue manually</button>':'<button class="primary" id="manualScan" type="button" disabled>Add card details</button>')+'</div><p class="scan-error" id="scanError"></p><p class="scan-note">Nothing is added until you review the suggested information and choose Add to collection.</p></div>';
      openModal();
      let frontInput=$('#scanFront'),backInput=$('#scanBack'),analyze=$('#analyzeCard'),manual=$('#manualScan');
      $('#chooseFront').onclick=()=>frontInput.click();
      $('#chooseBack').onclick=()=>backInput.click();
      function selected(input,side){
        let f=input.files[0];
        if(!f)return;
        if(side==='front'){
          frontFile=f;
          $('#chooseFront').classList.add('ready');
          $('#chooseFront').innerHTML='<b>✓</b><span>Front ready<br><small>Tap to replace</small></span>';
          let url=URL.createObjectURL(f);
          $('#photoFrame').innerHTML='<img class="scan-preview" alt="Selected card front" src="'+url+'"><b class="scan-check">✓</b>';
          $('.scan-stage').classList.add('done');
          $('.scan-status').textContent='FRONT PHOTO READY';
          if(analyze)analyze.disabled=false;
          manual.disabled=false;
        }else{
          backFile=f;
          $('#chooseBack').classList.add('ready');
          $('#chooseBack').innerHTML='<b>✓</b><span>Back ready<br><small>Tap to replace</small></span>';
        }
      }
      function review(result){
        let r=result||{};
        openCardForm(null);
        let form=$('#manualForm');
        ['player','year','set','number','parallel','sport','grade','team'].forEach(name=>{if(r[name])form.elements[name].value=r[name]});
        if(r.serial_number)form.elements.notes.value='Serial number: '+r.serial_number;
        function attach(file,input,preview){
          if(!file)return;
          let transfer=new DataTransfer();
          transfer.items.add(file);
          input.files=transfer.files;
          preview.src=URL.createObjectURL(file);
          preview.classList.add('show');
        }
        attach(frontFile,$('#frontPhoto'),$('#frontPreview'));
        attach(backFile,$('#backPhoto'),$('#backPreview'));
        $('#modal .kicker').textContent='REVIEW SCAN';
        $('#modal h2').textContent='Confirm the match.';
        $('.modal-sub').textContent='Review every field—especially the set, card number, and parallel—before adding it.';
      }
      frontInput.onchange=()=>selected(frontInput,'front');
      backInput.onchange=()=>selected(backInput,'back');
      manual.onclick=()=>review(null);
      if(analyze)analyze.onclick=async()=>{
        let error=$('#scanError');
        error.textContent='';
        if(!session){
          error.innerHTML='Sign in before using automatic recognition. <a href="/account" style="color:var(--accent)">Open account page</a>, or continue manually.';
          return;
        }
        analyze.disabled=true;
        manual.disabled=true;
        analyze.textContent='Analyzing photos…';
        $('.scan-status').textContent='LOOKING FOR CARD DETAILS';
        try{
          let front=await compressPhoto(frontFile),back=backFile?await compressPhoto(backFile):null;
          let response=await fetch('/api/scan-card',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({front,back})});
          let text=await response.text(),data=null;
          try{data=text?JSON.parse(text):null}catch(e){}
          if(!response.ok)throw new Error(data&&data.error||text||'The scan could not be completed.');
          $('.scan-status').textContent='MATCH READY TO REVIEW';
          review(data.card);
        }catch(err){
          error.textContent=err.message;
          analyze.disabled=false;
          manual.disabled=false;
          analyze.textContent='Try identification again';
          $('.scan-status').textContent='REVIEW PHOTO AND TRY AGAIN';
        }
      }
    }
    function compressPhoto(file){return new Promise((resolve,reject)=>{if(!file)return resolve(null);let image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{let maxW=900,maxH=1260,scale=Math.min(1,maxW/image.width,maxH/image.height),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);resolve(canvas.toDataURL('image/jpeg',.72))};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('photo'));};image.src=url})}
    function openCardForm(existing){let editing=!!existing,c=existing||{};$('#modal').className='modal form-modal';$('#modal').innerHTML='<button class="close" aria-label="Close">×</button><div class="modal-copy"><p class="kicker">'+(editing?'EDIT CARD':'MANUAL ENTRY')+'</p><h2>'+(editing?'Update card.':'Add a card.')+'</h2><p class="modal-sub">Track the card, its photos, purchase details, quantity, and where it belongs.</p><form class="manual-form" id="manualForm"><div class="field full"><span>Front and back photos</span><div class="photo-pair"><label><input id="frontPhoto" name="frontPhoto" type="file" accept="image/*"><small class="photo-hint">Front</small><img class="photo-preview" id="frontPreview" alt="Front preview"></label><label><input id="backPhoto" name="backPhoto" type="file" accept="image/*"><small class="photo-hint">Back</small><img class="photo-preview" id="backPreview" alt="Back preview"></label></div><small class="photo-hint">Photos are compressed before cloud sync.</small></div><label class="field full"><span>Player name *</span><input name="player" required autocomplete="off" placeholder="e.g. Aaron Judge"></label><label class="field"><span>Year *</span><input name="year" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="2024"></label><label class="field"><span>Sport *</span><select name="sport" required><option>Baseball</option><option>Basketball</option><option>Football</option><option>Hockey</option><option>Other</option></select></label><label class="field full"><span>Set *</span><input name="set" required placeholder="e.g. Topps Chrome"></label><label class="field"><span>Card number</span><input name="number" placeholder="#50"></label><label class="field"><span>Team</span><input name="team" placeholder="New York Yankees"></label><label class="field"><span>Parallel / variation</span><input name="parallel" placeholder="Base, Refractor, /99…"></label><label class="field"><span>Grade</span><input name="grade" placeholder="Raw, PSA 10…"></label><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" step="1" inputmode="numeric" value="1"></label><label class="field"><span>Current value · each</span><input name="price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label><label class="field"><span>Purchase price · each</span><input name="purchasePrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label><label class="field"><span>Purchase date</span><input name="purchaseDate" type="date"></label><label class="field"><span>Container</span><input name="container" list="containerOptions" autocomplete="off" placeholder="Binder 2, Monster Box A…"></label><label class="field"><span>Section</span><input name="section" list="sectionOptions" autocomplete="off" placeholder="Page 4, Row 3…"></label><label class="field"><span>Slot</span><input name="slot" autocomplete="off" placeholder="Slot 3, behind divider…"><datalist id="containerOptions"></datalist><datalist id="sectionOptions"></datalist></label><label class="field"><span>Collection type</span><select name="collectionStatus"><option>Personal collection</option><option>For sale</option><option>Trade pile</option><option>Uncategorized</option></select></label><label class="field full"><span>Notes and tags</span><textarea name="notes" placeholder="Rookie, autograph, numbered /99, condition notes…"></textarea></label><div class="remove-confirm" id="duplicateWarning"><p id="duplicateText"></p><p class="photo-hint" style="margin-top:9px">If you own more than one, setting Quantity above is usually better than adding a second entry.</p></div><p class="form-error" id="formError"></p><div class="form-actions"><button class="outline close2" type="button">Cancel</button><button class="primary submit-card" type="submit">'+(editing?'Save changes':'Add to collection')+'</button></div></form></div>';openModal();let form=$('#manualForm');$('#containerOptions').innerHTML=containersOf(cards).map(n=>'<option value="'+safe(n)+'"></option>').join('');$('#sectionOptions').innerHTML=[...new Set(cards.map(x=>String(x.section||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(n=>'<option value="'+safe(n)+'"></option>').join('');['player','year','sport','set','number','team','parallel','grade','quantity','purchasePrice','purchaseDate','container','section','slot','collectionStatus','notes'].forEach(name=>{if(c[name]!==undefined&&c[name]!==null)form.elements[name].value=c[name]});form.elements.price.value=cardPrice(c)||'';if(c.photo){$('#frontPreview').src=c.photo;$('#frontPreview').classList.add('show')}if(c.photoBack){$('#backPreview').src=c.photoBack;$('#backPreview').classList.add('show')}function previewInput(input,preview){input.onchange=e=>{let file=e.target.files[0];if(!file)return;preview.src=URL.createObjectURL(file);preview.classList.add('show')}}previewInput($('#frontPhoto'),$('#frontPreview'));previewInput($('#backPhoto'),$('#backPreview'));let duplicateAccepted=false;
    form.onsubmit=async e=>{e.preventDefault();let button=$('.submit-card'),error=$('#formError');
      // Adding a card you already own is nearly always a mistake, so ask once.
      // Editing is exempt: a card always matches itself.
      if(!editing&&!duplicateAccepted){
        let match=findDuplicate({player:form.elements.player.value,year:form.elements.year.value,set:form.elements.set.value,parallel:form.elements.parallel.value});
        if(match){
          duplicateAccepted=true;
          $('#duplicateText').innerHTML='Your collection already has <b>'+safe(match.player)+'</b> — '+safe(match.year)+' '+safe(match.set)+(match.parallel?' · '+safe(match.parallel):'')+'. Add a second entry anyway?';
          $('#duplicateWarning').classList.add('show');
          button.textContent='Add anyway';
          $('#duplicateWarning').scrollIntoView({block:'nearest'});
          return;
        }
      }
      button.disabled=true;button.textContent='Saving…';error.classList.remove('show');try{let data=new FormData(form),player=data.get('player').trim(),id=editing?c.id:crypto.randomUUID(),frontFile=data.get('frontPhoto'),backFile=data.get('backPhoto'),photo=frontFile&&frontFile.size?await compressPhoto(frontFile):(c.photo||null),photoBack=backFile&&backFile.size?await compressPhoto(backFile):(c.photoBack||null),card={id,player,year:data.get('year').trim(),set:data.get('set').trim(),number:data.get('number').trim()||'—',parallel:data.get('parallel').trim()||'Base',sport:data.get('sport'),grade:data.get('grade').trim()||'Raw',team:data.get('team').trim()||'Team not entered',initials:initialsFor(player),color:c.color||colorFor(id),photo,photoBack,frontImagePath:c.frontImagePath||null,backImagePath:c.backImagePath||null,quantity:Math.max(1,Number(data.get('quantity'))||1),purchasePrice:Number(data.get('purchasePrice'))||0,purchaseDate:data.get('purchaseDate'),container:data.get('container').trim(),section:data.get('section').trim(),slot:data.get('slot').trim(),location:c.location||'',collectionStatus:data.get('collectionStatus'),notes:data.get('notes').trim(),createdAt:editing?(c.createdAt||''):new Date().toISOString(),currentValue:Number(data.get('price'))||0};if(editing){customCards=customCards.map(x=>String(x.id)===String(id)?card:x)}else{customCards=[card].concat(customCards)}persistDeviceCards();cards=buildCards();recordSnapshot();if(session)queueSave(card);refreshSets();render();renderPricing();updateTotals();closeModal()}catch(err){error.textContent=err&&err.name==='QuotaExceededError'?'This device is out of local photo space. Try smaller images or remove earlier test cards.':err.message||'The card could not be saved. Please try again.';error.classList.add('show');reportError('card-save',err);button.disabled=false;button.textContent=editing?'Save changes':'Add to collection'}}}
    // Two cards count as the same when player, year, set and parallel all match.
    // Grade and quantity deliberately excluded: a raw and a graded copy of the
    // same card are genuinely different entries worth keeping apart.
    const locationText = c => [c.container,c.section,c.slot].map(v=>String(v||'').trim()).filter(Boolean).join(' · ')||String(c.location||'').trim();
    const containersOf = list => [...new Set(list.map(c=>String(c.container||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const duplicateKey = c => ['player','year','set','parallel'].map(k=>String(c[k]??'').trim().toLowerCase()).join('|');
    const findDuplicate = candidate => {let key=duplicateKey(candidate);return cards.find(c=>duplicateKey(c)===key)||null};
    function openAddCard(){openCardForm(null)}
    function openModal(){$('#backdrop').classList.add('open');$('.close').onclick=closeModal;let c=$('.close2');if(c)c.onclick=closeModal}function closeModal(){$('#backdrop').classList.remove('open');$('#modal').className='modal'}
    function renderPricing(){$('#priceList').innerHTML=cards.map(c=>'<div class="price-row"><div><h3>'+safe(c.player)+'</h3><p>'+safe(c.year)+' '+safe(c.set)+' · '+safe(c.parallel)+' · '+safe(c.grade)+'</p></div><input class="price-input" data-price-id="'+c.id+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+(cardPrice(c)||'')+'" placeholder="0.00" aria-label="Price for '+safe(c.player)+'"><button class="primary" data-save-id="'+c.id+'">Save</button></div>').join('');document.querySelectorAll('[data-save-id]').forEach(b=>b.onclick=async()=>{let id=b.dataset.saveId,input=$('[data-price-id="'+id+'"]'),v=Number(input.value),card=cards.find(c=>String(c.id)===id);if(!card)return;card.currentValue=v>0?v:0;persistDeviceCards();recordSnapshot();if(session)queueSave(card);b.textContent='Saved ✓';setTimeout(()=>b.textContent='Save',1200);render();updateTotals()})}
    function refreshSets(){let current=$('#setFilter').value;$('#setFilter').innerHTML='<option>All sets</option>'+[...new Set(cards.map(c=>c.set))].sort().map(s=>'<option>'+safe(s)+'</option>').join('');if([...$('#setFilter').options].some(o=>o.value===current))$('#setFilter').value=current;let filter=$('#containerFilter'),held=filter.value,counts={};cards.forEach(c=>{let k=String(c.container||'').trim();if(k)counts[k]=(counts[k]||0)+1});filter.innerHTML='<option>All locations</option>'+containersOf(cards).map(n=>'<option value="'+safe(n)+'">'+safe(n)+' ('+counts[n]+')</option>').join('');if([...filter.options].some(o=>o.value===held))filter.value=held}
    function showAccount(){let active=!!session;$('#signedOut').classList.toggle('hidden',active);$('#signedIn').classList.toggle('hidden',!active);$('#accountLink').textContent=active?'My account':'Sign in';if(active){$('#accountEmail').textContent=session.user.email;$('#accountName').textContent=session.user.user_metadata&&session.user.user_metadata.display_name||'Your account';let pending=readDeviceCards().length,button=$('#migrateCards');button.disabled=!pending;button.textContent=pending?'Move '+pending+' device card'+(pending===1?'':'s')+' to my account':'No device cards to move'}}
    async function initAccount(){if(session&&session.expires_at&&session.expires_at*1000<Date.now()+60000){let refresh=session.refresh_token;try{session=null;session=await sb('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:refresh})});localStorage.setItem('the-database-session',JSON.stringify(session))}catch(e){session=null;localStorage.removeItem('the-database-session')}}showAccount();renderSyncStatus();if(session){try{await flushOutbox();await loadCloudCards();await loadCloudHistory()}catch(e){$('#syncMessage').textContent='Cloud sync needs attention: '+e.message;reportError('sync-init',e)}}}
    let signupMode=false;$('#authSwitch').onclick=()=>{signupMode=!signupMode;$('#authForm').elements.displayName.classList.toggle('hidden',!signupMode);forgotPassword.classList.toggle('hidden',signupMode);$('#authForm').querySelector('button').textContent=signupMode?'Create account':'Sign in';$('#authSwitch').textContent=signupMode?'Already have an account? Sign in':'New here? Create an account';$('#authMessage').textContent=''};$('#authForm').elements.displayName.classList.add('hidden');
    $('#authForm').onsubmit=async e=>{e.preventDefault();let form=e.target,button=form.querySelector('button');button.disabled=true;$('#authMessage').textContent='';try{if(signupMode){let result=await sb('/auth/v1/signup',{method:'POST',body:JSON.stringify({email:form.elements.email.value,password:form.elements.password.value,data:{display_name:form.elements.displayName.value||''}})});if(result.access_token){session=result;localStorage.setItem('the-database-session',JSON.stringify(session));showAccount();await loadCloudCards()}else $('#authMessage').textContent='Check your email to confirm your account, then sign in.'}else{session=await sb('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:form.elements.email.value,password:form.elements.password.value})});localStorage.setItem('the-database-session',JSON.stringify(session));showAccount();await loadCloudCards()}}catch(err){$('#authMessage').textContent=err.message}button.disabled=false};
    $('#exportCollection').onclick=exportCollection;
    $('#signOut').onclick=async()=>{try{await sb('/auth/v1/logout',{method:'POST'})}catch(e){}session=null;localStorage.removeItem('the-database-session');localStorage.removeItem(SIGNED_KEY);location.reload()};
    $('#migrateCards').onclick=async()=>{let button=$('#migrateCards'),pending=readDeviceCards(),remaining=pending.slice(),moved=0;if(!session){$('#syncMessage').textContent='Sign in before moving device cards.';return}if(!pending.length){$('#syncMessage').textContent='No device cards were found to move.';button.disabled=true;button.textContent='No device cards to move';return}button.disabled=true;button.textContent='Moving cards…';try{for(let original of pending){let c=Object.assign({},original,{id:crypto.randomUUID()});await cloudSaveCard(c);remaining=remaining.filter(x=>String(x.id)!==String(original.id));localStorage.setItem('the-database-cards',JSON.stringify(remaining));moved++}await loadCloudCards();$('#syncMessage').textContent=moved+' device card'+(moved===1?'':'s')+' moved to your account.';button.disabled=true;button.textContent='Migration complete'}catch(err){reportError('migrate',err);$('#syncMessage').textContent=moved?moved+' card'+(moved===1?'':'s')+' moved before this error, the rest are still on this device: '+err.message:err.message;button.disabled=false;button.textContent='Try migration again'}};
    refreshSets();$('#scanMini').innerHTML=art(cards[1]||cards[0]||previewCard,true);
    const initialQuery=new URLSearchParams(location.search).get('q')||'';$('#search').value=initialQuery;$('#homeSearch').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim())location.href='/collection?q='+encodeURIComponent(e.target.value.trim())};let searchTimer=null;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,120)};$('#setFilter').onchange=render;$('#containerFilter').onchange=render;$('#sort').onchange=render;$('#tabs').onclick=e=>{if(e.target.dataset.sport){sport=e.target.dataset.sport;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b===e.target));render()}};$('#clear').onclick=()=>{$('#search').value='';$('#setFilter').value='All sets';$('#containerFilter').value='All locations';sport='All';document.querySelectorAll('#tabs button').forEach((b,i)=>b.classList.toggle('active',i===0));render()};$('#addCard').onclick=openAddCard;$('#scanCard').onclick=openScan;$('#backdrop').onclick=e=>{if(e.target===$('#backdrop'))closeModal()};document.onkeydown=e=>{if(e.key==='Escape')closeModal()};
    if(cards.some(c=>cardPrice(c)!==null)&&!valueHistory.length)recordSnapshot();render();renderPricing();updateTotals();initAccount();
    window.addEventListener('online',()=>{renderSyncStatus();flushOutbox()});window.addEventListener('offline',renderSyncStatus);const PHOTO_REFRESH_AFTER=45*60*1000;setInterval(()=>{if(session&&Date.now()-lastPhotoSign>PHOTO_REFRESH_AFTER)refreshPhotoUrls()},5*60*1000);document.addEventListener('visibilitychange',()=>{if(document.hidden||!session)return;flushOutbox();if(Date.now()-lastPhotoSign>PHOTO_REFRESH_AFTER)refreshPhotoUrls()});
    let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp').classList.add('show')});$('#installApp').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#installApp').classList.remove('show')}else alert('On iPhone, open Share and choose Add to Home Screen.')};if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');window.addEventListener('error',e=>reportError('window',e.error||e.message));window.addEventListener('unhandledrejection',e=>reportError('promise',e.reason));
    const forgotPassword=$('#forgotPassword');
    const b64url = bytes => {let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/,'')};
    function newVerifier(){let bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return b64url(bytes)}
    async function challengeFor(verifier){let digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));return b64url(new Uint8Array(digest))}
    forgotPassword.onclick=async()=>{let email=$('#authForm').elements.email.value.trim(),message=$('#authMessage');message.classList.remove('reset-success');if(!email){message.textContent='Enter your email address first.';$('#authForm').elements.email.focus();return}forgotPassword.disabled=true;forgotPassword.textContent='Sending reset link…';try{let body={email};try{let verifier=newVerifier();body.code_challenge=await challengeFor(verifier);body.code_challenge_method='s256';localStorage.setItem('the-database-pkce-verifier',verifier)}catch(e){localStorage.removeItem('the-database-pkce-verifier')}await sb('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+'/reset-password'),{method:'POST',body:JSON.stringify(body)});message.textContent='If an account exists for that email, a reset link is on the way.';message.classList.add('reset-success')}catch(err){message.textContent=err.message}finally{forgotPassword.disabled=false;forgotPassword.textContent='Forgot password?'}};
    const resetForm=$('#resetForm'),resetMessage=$('#resetMessage'),hashParams=new URLSearchParams(location.hash.slice(1)),queryParams=new URLSearchParams(location.search);
    let recoveryToken=hashParams.get('access_token');
    const isRecovery=hashParams.get('type')==='recovery',recoveryCode=queryParams.get('code'),linkError=hashParams.get('error_description')||queryParams.get('error_description'),expiredMessage='This reset link is invalid or has expired. Request a new link from the sign-in page.';
    function resetUnavailable(text){resetMessage.textContent=text;resetMessage.classList.remove('reset-success');resetForm.classList.add('hidden');$('#returnToSignIn').classList.remove('hidden')}
    async function initReset(){
      if(document.body.dataset.page!=='reset-password')return;
      if(linkError){resetUnavailable(linkError);return}
      if(recoveryCode){
        let verifier=localStorage.getItem('the-database-pkce-verifier');
        if(!verifier){resetUnavailable('Open the reset link on the same device and browser where you asked for it, or request a new link.');return}
        resetForm.classList.add('hidden');
        resetMessage.textContent='Checking your reset link…';
        try{
          let exchanged=await sb('/auth/v1/token?grant_type=pkce',{method:'POST',body:JSON.stringify({auth_code:recoveryCode,code_verifier:verifier})});
          if(!exchanged||!exchanged.access_token)throw new Error('no token');
          recoveryToken=exchanged.access_token;
          localStorage.removeItem('the-database-pkce-verifier');
          resetMessage.textContent='';
          resetForm.classList.remove('hidden');
        }catch(err){resetUnavailable(expiredMessage)}
        return;
      }
      if(!recoveryToken||!isRecovery)resetUnavailable(expiredMessage);
    }
    initReset();
    resetForm.onsubmit=async e=>{e.preventDefault();let password=e.target.elements.password.value,confirmation=e.target.elements.confirmPassword.value,button=e.target.querySelector('button');resetMessage.classList.remove('reset-success');if(password.length<8){resetMessage.textContent='Use at least 8 characters.';return}if(password!==confirmation){resetMessage.textContent='The passwords do not match.';return}if(!recoveryToken){resetMessage.textContent=expiredMessage;return}button.disabled=true;button.textContent='Updating password…';try{let response=await fetch(SUPABASE_URL+'/auth/v1/user',{method:'PUT',headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+recoveryToken,'Content-Type':'application/json'},body:JSON.stringify({password})}),text=await response.text(),data=null;try{data=text?JSON.parse(text):null}catch(err){}if(!response.ok)throw new Error(data&&((data.msg)||(data.message)||(data.error_description))||text||'Password update failed');resetMessage.textContent='Password updated. You can now sign in.';resetMessage.classList.add('reset-success');resetForm.classList.add('hidden');$('#returnToSignIn').classList.remove('hidden');history.replaceState({},'',location.pathname)}catch(err){resetMessage.textContent=err.message;button.disabled=false;button.textContent='Update password'}};
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/manifest.webmanifest") return new Response(JSON.stringify({name:"The Database",short_name:"Database",description:"Browse and manage a sports card collection.",start_url:"/",display:"standalone",background_color:"#0b0f0d",theme_color:"#0b0f0d"}), {headers:{"content-type":"application/manifest+json"}});
    if (path === "/sw.js") return new Response("const CACHE='the-database-" + VERSION + "';self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/collection','/pricing','/scan','/account','/reset-password']))) });self.addEventListener('activate',e=>e.waitUntil(Promise.all([clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))})", {headers:{"content-type":"application/javascript","cache-control":"no-cache"}});
    if (path === "/api/scan-card" && request.method === "POST") {
      const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{"content-type":"application/json","cache-control":"no-store"}});
      if (!env.OPENAI_API_KEY) return json({error:"Automatic recognition is not configured yet. Add OPENAI_API_KEY as a Cloudflare secret."}, 503);
      const auth = request.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) return json({error:"Sign in before using automatic recognition."}, 401);
      const supabaseUrl = env.SUPABASE_URL || env.supabase_url || "";
      const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.supabase_publishable_key || "";
      if (!supabaseUrl || !supabaseKey) return json({error:"Account service is not configured."}, 503);
      const userCheck = await fetch(supabaseUrl + "/auth/v1/user", {headers:{apikey:supabaseKey, authorization:auth}});
      if (!userCheck.ok) return json({error:"Your session expired. Sign in again and retry."}, 401);
      let user = null;
      try { user = await userCheck.json(); } catch (e) {}
      if (!user || !user.id) return json({error:"Your session expired. Sign in again and retry."}, 401);
      let input;
      try { input = await request.json(); } catch (e) { return json({error:"The scanner received an invalid request."}, 400); }
      if (!input.front || !String(input.front).startsWith("data:image/")) return json({error:"A front photo is required."}, 400);
      // Per-user daily cap so one account cannot run up the OpenAI bill.
      const dailyLimit = Number(env.SCAN_DAILY_LIMIT) > 0 ? Number(env.SCAN_DAILY_LIMIT) : 25;
      const restHeaders = {apikey:supabaseKey, authorization:auth, "content-type":"application/json"};
      const since = new Date(Date.now() - 86400000).toISOString();
      const countRes = await fetch(
        supabaseUrl + "/rest/v1/scan_events?select=id&limit=1&user_id=eq." + encodeURIComponent(user.id) + "&created_at=gte." + encodeURIComponent(since),
        {headers:Object.assign({Prefer:"count=exact"}, restHeaders)}
      );
      if (!countRes.ok) return json({error:"Scan limits are not set up yet. Run the latest supabase/setup.sql in your Supabase SQL editor."}, 503);
      const used = Number((countRes.headers.get("content-range") || "").split("/")[1]);
      if (Number.isFinite(used) && used >= dailyLimit) return json({error:"You have used all " + dailyLimit + " card scans for today. You can still add cards manually, or try again tomorrow."}, 429);
      // Logged before the call: the cost is incurred whether or not recognition succeeds.
      const logRes = await fetch(supabaseUrl + "/rest/v1/scan_events", {method:"POST", headers:Object.assign({Prefer:"return=minimal"}, restHeaders), body:JSON.stringify({user_id:user.id})});
      if (!logRes.ok) return json({error:"The scan could not be recorded, so it was not run. Try again in a moment."}, 503);
      const content = [
        {type:"input_text", text:"Identify this sports trading card from the supplied photos. Read only visible evidence. Do not invent missing details. Distinguish parallels or variations only when visual evidence supports it. Return an empty string for unknown fields. Confidence must be high, medium, or low."},
        {type:"input_image", image_url:input.front, detail:"high"}
      ];
      if (input.back && String(input.back).startsWith("data:image/")) content.push({type:"input_image", image_url:input.back, detail:"high"});
      const aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method:"POST",
        headers:{"authorization":"Bearer " + env.OPENAI_API_KEY,"content-type":"application/json"},
        body:JSON.stringify({
          model:env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
          input:[{role:"user",content}],
          text:{format:{type:"json_schema",name:"sports_card",strict:true,schema:{type:"object",additionalProperties:false,properties:{
            player:{type:"string"},year:{type:"string"},set:{type:"string"},number:{type:"string"},parallel:{type:"string"},sport:{type:"string"},team:{type:"string"},grade:{type:"string"},serial_number:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]}
          },required:["player","year","set","number","parallel","sport","team","grade","serial_number","confidence"]}}},
          max_output_tokens:500
        })
      });
      const aiText = await aiResponse.text();
      let aiData;
      try { aiData = JSON.parse(aiText); } catch (e) { return json({error:"The recognition service returned an unreadable response."}, 502); }
      if (!aiResponse.ok) return json({error:(aiData.error && aiData.error.message) || "Card recognition failed."}, aiResponse.status);
      const outputText = (aiData.output || []).flatMap(item => item.content || []).find(item => item.type === "output_text");
      if (!outputText || !outputText.text) return json({error:"No card details were returned. Try clearer front and back photos."}, 422);
      let card;
      try { card = JSON.parse(outputText.text); } catch (e) { return json({error:"The suggested card details could not be read."}, 502); }
      return json({card});
    }
    const routes={"/":"home","/collection":"collection","/pricing":"pricing","/scan":"scan","/account":"account","/reset-password":"reset-password"};
    if (!routes[path]) return new Response("Not found", { status: 404 });
    return new Response(page(routes[path], env), { headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" } });
  },
};
