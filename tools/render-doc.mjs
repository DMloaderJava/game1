import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked'; // npm i marked

const md = readFileSync(new URL('../docs/CONCEPT.md', import.meta.url), 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Архитектор Парадоксов — концепт-документ</title>
<style>
  :root{--ink:#07040f;--violet:#a855ff;--copper:#c1743f;--paper:#ece5fb;--muted:#a294c2}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--paper);font-family:"Segoe UI",Roboto,Inter,system-ui,sans-serif;line-height:1.8;
    background-image:radial-gradient(ellipse at 50% -10%,rgba(168,85,255,.16),transparent 60%);}
  .top{position:sticky;top:0;z-index:5;backdrop-filter:blur(10px);background:rgba(7,4,15,.75);border-bottom:1px solid rgba(168,85,255,.16);
    padding:14px 0}
  .top .in{max-width:840px;margin:0 auto;padding:0 28px;display:flex;justify-content:space-between;align-items:center;gap:16px;
    font-size:11px;letter-spacing:.24em;text-transform:uppercase}
  .top a{color:#c9a0ff;text-decoration:none}
  .top a:hover{color:#fff}
  main{max-width:840px;margin:0 auto;padding:64px 28px 140px}
  h1{font-size:clamp(30px,5vw,54px);font-weight:200;line-height:1.06;letter-spacing:-.01em;text-transform:uppercase;margin:0 0 6px;
    background:linear-gradient(175deg,#fff,#c8a8ff 55%,#7a3ec0);-webkit-background-clip:text;background-clip:text;color:transparent}
  h2{font-size:clamp(22px,3.2vw,32px);font-weight:300;margin:72px 0 18px;padding-top:28px;border-top:1px solid rgba(168,85,255,.16)}
  h3{font-size:19px;font-weight:500;margin:40px 0 12px;color:#e2d4ff}
  h4{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin:30px 0 8px}
  p{color:#c9bde3;font-size:15.5px}
  strong{color:#efe4ff;font-weight:600}
  em{color:#b9a8dc}
  a{color:#c9a0ff}
  hr{border:0;border-top:1px solid rgba(168,85,255,.14);margin:46px 0}
  blockquote{margin:28px 0;padding:18px 26px;border-left:2px solid var(--violet);background:rgba(168,85,255,.06);color:#e0d3ff}
  blockquote p{margin:0;color:#e0d3ff;font-size:16px}
  code{background:rgba(168,85,255,.14);padding:2px 6px;border-radius:3px;font-size:.88em;color:#e4d6ff}
  ul,ol{padding-left:22px;color:#c9bde3;font-size:15.5px}
  li{margin:7px 0}
  img{display:block;width:100%;border:1px solid rgba(168,85,255,.18);margin:26px 0;border-radius:2px}
  table{width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;display:block;overflow-x:auto}
  th,td{border:1px solid rgba(168,85,255,.18);padding:10px 13px;text-align:left;vertical-align:top}
  th{background:rgba(168,85,255,.1);color:#e2d4ff;font-weight:600;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase}
  td{color:#bbafd6}
  input[type=checkbox]{margin-right:8px;accent-color:#a855ff}
  li:has(input[type=checkbox]){list-style:none;margin-left:-20px}
  footer{max-width:840px;margin:0 auto;padding:0 28px 80px;color:#6d5f8f;font-size:12px}
</style>
</head>
<body>
<div class="top"><div class="in">
  <a href="../index.html">← Архитектор Парадоксов</a>
  <span><a href="../prototype/index.html">Играть в прототип →</a></span>
</div></div>
<main>
${body}
</main>
<footer>Документ сгенерирован из docs/CONCEPT.md · v1.0</footer>
</body>
</html>`;

writeFileSync(new URL('../docs/concept.html', import.meta.url), html, 'utf8');
console.log('docs/concept.html written,', html.length, 'bytes');
