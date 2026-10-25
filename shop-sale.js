(() => {
  const endsAt = Date.parse('2026-11-12T00:00:00+08:00');
  const root = document.documentElement;
  let timer;
  const salePrice = original => Math.round(Number(original) * 80) / 100;

  function updateShopSale() {
    const active = Date.now() < endsAt;
    if (active) root.dataset.shopSale = 'active';
    else delete root.dataset.shopSale;

    const product = document.querySelector('[data-product-title]');
    if (product) {
      const variant = document.querySelector('input[name="variant"]:checked');
      const original = variant?.dataset.variantOriginal || variant?.dataset.variantPrice || product.dataset.productOriginal;
      product.dataset.productPrice = String(active ? salePrice(original) : original);
      if (active) product.dataset.productSale = '双十一 8 折';
      else delete product.dataset.productSale;
      const price = document.querySelector('.detail-price [data-shop-price]');
      if (price) price.dataset.originalPrice = original;
      const saving = document.querySelector('.detail-copy [data-sale-saving]');
      if (saving) saving.dataset.originalPrice = original;
      const originalPrice = document.querySelector('.original-price [data-original-price]');
      if (originalPrice) originalPrice.textContent = original;
    }

    document.querySelectorAll('[data-shop-price]').forEach(price => {
      price.textContent = active ? salePrice(price.dataset.originalPrice) : price.dataset.originalPrice;
    });
    document.querySelectorAll('[data-sale-saving]').forEach(saving => {
      saving.textContent = `立省 ¥${Math.round((Number(saving.dataset.originalPrice) - salePrice(saving.dataset.originalPrice)) * 100) / 100}`;
    });
    document.dispatchEvent(new Event('shop-sale-change'));
    clearTimeout(timer);
    if (active) timer = setTimeout(updateShopSale, Math.min(endsAt - Date.now(), 2147483647));
  }

  window.updateShopSale = updateShopSale;
  document.addEventListener('visibilitychange', updateShopSale);
  window.addEventListener('pageshow', updateShopSale);
  updateShopSale();
})();
