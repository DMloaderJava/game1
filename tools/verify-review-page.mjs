// Проверка страницы ревью: структура, локальные ссылки, запуск игры по кнопке
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));

// грубая проверка структуры: все локальные картинки существуют
const imgs = [...html.matchAll(/src="([^"#]+\.(png|html|md))"/g)].map(m=>m[1]);
const missing = imgs.filter(p => !fs.existsSync(new URL('../' + p, import.meta.url)));
console.log('ссылок на локальные файлы:', imgs.length, '| отсутствуют:', missing.length ? missing : '—');

// выполняем скрипт страницы на минимальном DOM
function el(tag='div') {
  const e = {
    tag, children: [], style: {}, className: '', id: '', textContent: '', complete: false, naturalWidth: 0,
    listeners: {},
    classList: { add(c){ e.className = c; }, remove(){}, contains(){ return false; } },
    addEventListener(t, fn) { (e.listeners[t] ||= []).push(fn); },
    appendChild(c) { e.children.push(c); return c; },
    querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    parentNode: { insertBefore(n){ e.children.push(n); } },
    get lastElementChild() { return { textContent: '' }; }
  };
  return e;
}
const nodes = { veil: el(), stage: el(), 'play-btn': el(), 'chip-shots': el(), 'chip-game': el(), 'shot-grid': el() };
const doc = {
  getElementById: (id) => nodes[id] || el(),
  querySelectorAll: (sel) => sel === '.shots img, #poster' ? [el(), el()] : [],
  querySelector: () => null,
  createElement: (t) => el(t)
};
const sb = {
  console, performance, Math, Date, Promise, setTimeout,
  document: doc,
  window: { pageYOffset: 0, scrollTo(){}, addEventListener(){} },
  fetch: () => Promise.resolve({ ok: true, headers: { get: () => String(200*1024) } })
};
sb.globalThis = sb;
vm.runInNewContext(js, sb);
await new Promise(r => setTimeout(r, 50));
console.log('скрипт страницы выполнен без исключений');
console.log('внедрён ли фрейм до клика:', nodes.stage.children.length);
nodes['play-btn'].listeners.click[0]();
console.log('после клика «Запустить» фреймов:', nodes.stage.children.length, '| src:', nodes.stage.children[0]?.src);
