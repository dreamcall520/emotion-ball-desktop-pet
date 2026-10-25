(function exposeCreditBalance(scope) {
  'use strict';
  function creditBalanceText(balance) {
    if (typeof balance !== 'string' || balance.length > 128 || !/^\d+(?:\.\d+)?$/u.test(balance)) return '暂未提供';
    const [integer, fraction = ''] = balance.split('.');
    const whole = integer.replace(/^0+(?=\d)/u, '');
    if (!/[1-9]/u.test(whole + fraction)) return '0.00';
    if (whole === '0' && !/[1-9]/u.test(fraction.slice(0, 2))) return '<0.01';
    const decimals = `${fraction}000`;
    let cents = BigInt(whole) * 100n + BigInt(decimals.slice(0, 2));
    if (Number(decimals[2]) >= 5) cents += 1n;
    const digits = cents.toString().padStart(3, '0');
    return `${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${digits.slice(-2)}`;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = creditBalanceText;
  else scope.petCreditBalanceText = creditBalanceText;
})(typeof window !== 'undefined' ? window : globalThis);
