const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const get=async u=>{const r=await fetch(u,{headers:{'User-Agent':UA,Referer:'https://m.stock.naver.com/'}});return r.json();};
const n=v=>v==null?null:parseFloat(String(v).replace(/[,+]/g,''));
(async()=>{
  const stocks=[];
  for(let p=1;p<=10;p++){const j=await get(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100`);if(!j.stocks||!j.stocks.length)break;
    j.stocks.forEach(s=>stocks.push({c:s.itemCode,n:s.stockName,m:n(s.marketValue),r:n(s.fluctuationsRatio),e:s.stockEndType}));}
  const groups=[];let pg=1;
  while(true){const j=await get(`https://m.stock.naver.com/api/stocks/industry?page=${pg}&pageSize=100`);groups.push(...j.groups);if(groups.length>=j.totalCount||!j.groups.length)break;pg++;}
  const sec={};let sample=null;
  for(const g of groups){const j=await get(`https://m.stock.naver.com/api/stocks/industry/${g.no}?page=1&pageSize=100`);if(!sample)sample=JSON.stringify(j).slice(0,800);
    (j.stocks||[]).forEach(s=>sec[s.itemCode]=g.name);}
  console.log('stocks',stocks.length,'groups',groups.length,'mapped',Object.keys(sec).length);console.log(sample);
  stocks.forEach(s=>s.s=sec[s.c]||null);
  require('fs').writeFileSync('kospi.json',JSON.stringify({ts:new Date().toISOString(),stocks}));
})();
