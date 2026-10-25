// A separate, bounded presentation channel never changes card data or native geometry.
const active=new WeakSet();
function sendQuotaCardMotion(target, visible, presentation, animate) {
  const enabled=animate===true && presentation?.quotaReducedMotion!==true;
  const grouped=presentation?.quotaGroupAnimate===true;
  if(!grouped&&!active.has(target))return enabled;
  if(grouped)active.add(target);else active.delete(target);
  target.webContents.send('pet:quota-card-motion',{visible,animate:enabled && presentation?.quotaGroupAnimate===true,
    index:Number.isInteger(presentation?.quotaGroupIndex)?Math.max(0,Math.min(3,presentation.quotaGroupIndex)):0});
  return enabled;
}
module.exports={sendQuotaCardMotion};
