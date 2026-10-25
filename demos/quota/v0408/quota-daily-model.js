/* Recorded decreases are a reference, not necessarily a complete day's usage. */
(function(root) {
  const GAP = 300000;
  const dayStart = at => new Date(new Date(at).setHours(0,0,0,0)).getTime();
  const nextDay = at => { const date = new Date(at); date.setDate(date.getDate()+1); return date.getTime(); };
  function build(samples,{start,end,boundaries=[]}) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const rows = [];
    for (let at = dayStart(start); at <= dayStart(end); at = nextDay(at)) {
      const until = nextDay(at), list = samples.filter(sample => sample.at >= Math.max(at,start) && sample.at < until && sample.at <= end);
      const row = {at,count:list.length,amount:null,correction:false,increased:false,reset:false,partial:true};
      if (list.length > 1) {
        row.amount = 0; let comparisons = 0;
        row.partial = start > at || list[0].at-at >= GAP || Math.min(until,end)-list.at(-1).at >= GAP;
        for (let i = 1; i < list.length; i++) {
          const previous = list[i-1], sample = list[i], drop = previous.remaining-sample.remaining;
          if (boundaries.some(boundary => previous.at < boundary && boundary <= sample.at)) { row.reset = true; row.partial = true; continue; }
          if (drop < 0 || drop >= 25) { row.correction = true; if(drop<0)row.increased=true; continue; }
          if (sample.at-previous.at >= GAP) { row.partial = true; continue; }
          row.amount += drop; comparisons++;
        }
        if (!comparisons) row.amount = null;
        else row.amount = Number(row.amount.toFixed(6));
      }
      rows.push(row);
    }
    return rows;
  }
  const api = {build,dayStart,GAP};
  if (typeof module !== 'undefined') module.exports = api; else root.TrendDaily = api;
})(typeof window === 'undefined' ? this : window);
