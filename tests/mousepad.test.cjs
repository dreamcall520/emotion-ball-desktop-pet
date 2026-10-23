const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('shop/mousepad/index.html');
const styles = [...html.matchAll(/name="style" value="([^"]+)" data-variant-image="([^"]+)"/g)];
const sizes = [...html.matchAll(/name="variant" value="([^"]+)" data-variant-price="(\d+)"/g)];
assert.equal(styles.length, 44);
assert.deepEqual(styles.map(match => match[1]), ["春野拼布", "夕光雾蓝", "蜜桃奶油", "奶油花格", "春野涂鸦", "花野派对", "焦糖海岸", "桂花暮紫", "春野杂货铺", "林间花笺", "橘日咖啡", "薄荷周末", "晴日生活拼布", "焦糖曲奇时光", "好运云朵", "午夜花砖", "杏霞蓝汐", "薄荷休息站", "快乐补给站", "柠檬气泡", "奶油小剧场", "蓝莓偷乐", "橘子捣蛋日", "晴天野餐会", "午夜摸鱼站", "森林偷乐站", "橘晴好运", "莓莓开心云", "可可偷吃日", "奶糖恶作剧", "森林元气云", "午夜活力云", "健身拼布复古配色", "健身拼布·明亮原色", "橘红元气小剧场", "暖橘贴纸俱乐部", "焦糖手账角落", "午夜蓝贴纸俱乐部", "薄荷手账角落", "橘暖休息站", "焦糖偷乐站", "奶油漫画小剧场", "暖杏快乐小剧场", "好运花色小剧场"]);
assert.deepEqual(sizes.map(match => [match[1], match[2]]), [['800×300mm · 厚3mm', '50'], ['800×400mm · 厚3mm', '60']]);
for (const [, , image] of styles) assert.ok(fs.existsSync(path.join(__dirname, '../shop/mousepad', image)));
assert.match(read('shop/index.html'), /href="mousepad\/"/);
assert.match(read('shop/index.html'), /mousepad\/p01.webp/);
assert.match(html, /value="春野拼布" data-variant-image="[^\"]+\/p01.webp" checked/);

function run(withOptions) {
  const element = (properties = {}) => ({ dataset: {}, handlers: {},
    addEventListener(event, fn) { this.handlers[event] = fn; }, ...properties });
  const theme = element(), button = element({ dataset: { dialogOpen: 'wechat-dialog' } });
  const product = element({ textContent: withOptions ? '春野定制鼠标垫' : '春野奶白随行杯', dataset: { productPrice: withOptions ? '50' : '66' } });
  const image = element(), price = element(), inquiry = element(), status = element(), sales = element();
  const styleInputs = withOptions ? styles.map(([, value, url]) => element({ value, dataset: { variantImage: url } })) : [];
  const sizeInputs = sizes.map(([, value, amount]) => element({ value, dataset: { variantPrice: amount } }));
  const selected = { style: styleInputs[0], variant: withOptions ? sizeInputs[0] : { value: '260ml' } };
  const dialog = { querySelector: selector => selector === '[data-inquiry]' ? inquiry : status, showModal() {} };
  const document = { documentElement: { dataset: {} }, addEventListener() {},
    getElementById: () => dialog,
    querySelector: selector => ({ '[data-theme-select]': theme, '[data-product-title]': product, '[data-product-image]': image, '[data-price-value]': price, '[data-selected-sales]': sales, 'input[name="variant"]:checked': selected.variant, 'input[name="style"]:checked': selected.style })[selector],
    querySelectorAll: selector => ({ '[data-dialog-open]': [button], '[data-variant-image]': styleInputs, '[data-variant-price]': withOptions ? sizeInputs : [] })[selector] || []
  };
  vm.runInNewContext(read('community.js'), { document, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem() {} } });
  return { selected, styleInputs, sizeInputs, button, product, image, price, inquiry, sales };
}
const state = run(true);
assert.match(state.sales.innerHTML, /已售 3 件/);
const confirmedSales = { '花野派对': 1, '春野拼布': 3, '夕光雾蓝': 5, '橘日咖啡': 3, '春野杂货铺': 1 };
for (const style of state.styleInputs) {
  state.selected.style = style;
  style.handlers.change();
  assert.equal(state.image.src, style.dataset.variantImage);
  assert.ok(state.image.alt.includes(style.value));
  assert.equal(state.sales.hidden, confirmedSales[style.value] === undefined);
  assert.equal(state.sales.innerHTML.includes('热度最高'), style.value === '夕光雾蓝');
  if (confirmedSales[style.value] !== undefined) assert.ok(state.sales.innerHTML.includes(`已售 ${confirmedSales[style.value]} 件`));
  else assert.equal(state.sales.innerHTML, '');
  for (const size of state.sizeInputs) {
    state.selected.variant = size;
    size.handlers.change();
    state.button.handlers.click();
    assert.equal(state.price.textContent, size.dataset.variantPrice);
    assert.equal(state.inquiry.textContent, `春野定制鼠标垫 · ${style.value} · ${size.value} · ¥${size.dataset.variantPrice}\n想确认商品细节与发货安排。`);
  }
}
const cup = run(false);
cup.button.handlers.click();
assert.equal(cup.inquiry.textContent, '春野奶白随行杯 · 260ml · ¥66\n想确认商品细节与发货安排。');
console.log('Mousepad: 88 image/size/price/inquiry combinations and existing cup inquiry passed');
