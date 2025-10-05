// Ocean-only, risk-aware A* routing over a lat/lng grid.
// Strict land-first masking + sea carveouts + coast buffer.
// Cost = distance + λ_risk * risk + λ_turn * turn + λ_coast * coastPenalty

self.onmessage = (e)=>{
  const { type } = e.data || {};
  if(type !== 'plan') return;

  const { origin, dest, hazards, mode, riskWeight, stepDeg, bounds } = e.data;
  const p = weightsForMode(mode, riskWeight);
  const grid = buildGrid(bounds, stepDeg || 0.28);
  const heat = buildRiskHeat(grid, hazards || []);
  const path = aStar(origin, dest, grid, heat, p);
  self.postMessage({ type:'ai_path', path });
};

function weightsForMode(mode, risk){
  const presets = {
    fastest:  { wDist:1.0, wRisk:Math.max(0.2, risk*0.4), wTurn:0.06, wCoast:70 },
    safest:   { wDist:1.2, wRisk:Math.max(1.5, risk*1.8), wTurn:0.12, wCoast:90 },
    fuel:     { wDist:0.9, wRisk:Math.max(0.9, risk*1.2), wTurn:0.20, wCoast:80 },
    balanced: { wDist:1.0, wRisk:Math.max(1.2, risk),     wTurn:0.15, wCoast:80 },
  };
  return presets[mode] || presets.balanced;
}

/* ----- LAND / SEA (coast-aware) ----- */
const LAND = [
  [7,83,-168,-52], [-56,13,-82,-34], [36,72,-31,60], [-35,37,-18,52],
  [0,78,26,180], [-45,-10,112,155], [59,83,-75,-11], [-90,-60,-180,180],
  // Islands + Gulf details
  [-7,6,95,106], [-9.5,-5.5,105,114], [-4,7.5,108,118], [-6,4,119,125.5],
  [-11,2,130,153], [5,21,120,126], [5,10,79,82], [0,7,100,105],
  [24,27,50.5,52.7], [24.4,26.3,50.0,50.9], [24.3,26.4,51.0,51.7], [28.4,29.6,47.0,48.8],
];
const SEAS = [
  [30,46,-6,36],[40,47,27,42],[53,66,9,31],[12,30,33,44],[23,31,48,57], // Med, Black, Baltic, Red, Arabian Gulf
  [18,31,-98,-80],[9,23,-90,-60],[51,61,-4,9], // GoM, Caribbean, North Sea
  // SE Asia corridors
  [-10,0,105,120],[-6,4,116,121],[1,9,117,126],[-9,-4,118,123],[-7,-5,114,117],
  [-8,-3,122,132],[-4,-1,129,134],[-12,-4,130,142],[-13,-8,123,130],
  [-11,-9,120,125],[4,12,118,123],[8,10.5,123,126],[6,14,99,106]
];
const MIN_COAST_KM_OPEN=25, MIN_COAST_KM_SEA=8, COAST_PREF_KM=60;

function inBox(lat,lng,[a,b,c,d]){ return lat>=Math.min(a,b)&&lat<=Math.max(a,b)&&lng>=Math.min(c,d)&&lng<=Math.max(c,d); }
function containingSea(lat,lng){ for(const r of SEAS){ if(inBox(lat,lng,r)) return r; } return null; }

function distanceKmToRect(lat,lng,[lat1,lat2,lon1,lon2]){
  const a=Math.min(lat1,lat2), b=Math.max(lat1,lat2);
  const c=Math.min(lon1,lon2), d=Math.max(lon1,lon2);
  const clat = (lat < a) ? a : (lat > b ? b : lat);
  const clon = (lng < c) ? c : (lng > d ? d : lng);
  const dLatKm = Math.abs(lat - clat) * 111;
  const dLonKm = Math.abs(lng - clon) * (111*Math.cos(lat*Math.PI/180) || 0);
  return Math.hypot(dLatKm, dLonKm);
}
function distanceKmToSeaEdgeInside(lat, lng, seaRect){
  const [lat1,lat2,lon1,lon2] = seaRect;
  const a=Math.min(lat1,lat2), b=Math.max(lat1,lat2);
  const c=Math.min(lon1,lon2), d=Math.max(lon1,lon2);
  const kmLat = Math.min(Math.abs(lat - a), Math.abs(b - lat)) * 111;
  const kmLon = Math.min(Math.abs(lng - c), Math.abs(d - lng)) * (111*Math.cos(lat*Math.PI/180) || 0);
  return Math.min(kmLat, kmLon);
}
function isOceanBase(lat,lng){
  let insideLand=false;
  for(const r of LAND){ if(inBox(lat,lng,r)){ insideLand=true; break; } }
  return insideLand ? !!containingSea(lat,lng) : true;
}
function coastDistanceKm(lat,lng){
  const sea = containingSea(lat,lng);
  if(sea) return distanceKmToSeaEdgeInside(lat,lng,sea);
  let best = Infinity;
  for(const r of LAND){ const d = distanceKmToRect(lat,lng,r); if(d < best) best = d; }
  return best;
}
function oceanBufferOK(lat,lng){
  if(!isOceanBase(lat,lng)) return false;
  const sea = containingSea(lat,lng);
  const min = sea ? MIN_COAST_KM_SEA : MIN_COAST_KM_OPEN;
  return coastDistanceKm(lat,lng) >= min;
}
function segmentOceanOK(latA,lngA,latB,lngB, samples=24){
  for(let s=0;s<=samples;s++){
    const t = s/samples;
    const lat = latA + t*(latB-latA);
    const lng = lngA + t*(lngB-lngA);
    if(!oceanBufferOK(lat,lng)) return false;
  }
  return true;
}
function coastPenalty(lat,lng){
  const dist = coastDistanceKm(lat,lng);
  if(dist >= COAST_PREF_KM) return 0;
  const x = Math.max(0, (COAST_PREF_KM - dist)/COAST_PREF_KM);
  return x*x*10;
}

/* ----- GRID & RISK ----- */
const round = x=>Math.round(x*1000)/1000;

function buildGrid(b, step){
  const lats=[], lngs=[];
  for(let lat=b.minLat; lat<=b.maxLat; lat+=step) lats.push(round(lat));
  for(let lng=b.minLng; lng<=b.maxLng; lng+=step) lngs.push(round(lng));
  const nodes=[];
  for(let i=0;i<lats.length;i++){
    for(let j=0;j<lngs.length;j++){
      const lat=lats[i], lng=lngs[j];
      if(!oceanBufferOK(lat,lng)) continue;
      nodes.push({ i,j, lat, lng });
    }
  }
  return { lats, lngs, nodes, step };
}

function buildRiskHeat(grid, hazards){
  const heat = new Map();
  for(const n of grid.nodes){
    let rsum=0;
    for(const h of hazards){
      const d = haversine([n.lat,n.lng],[h.lat,h.lng]);
      const R=h.r||100, sigma=Math.max(20,R*0.8), inside=d<=R*0.7;
      const contrib = inside ? 50 : (h.risk||0.6)*Math.exp(-(d*d)/(2*sigma*sigma))*10;
      rsum += contrib;
    }
    heat.set(key(n.i,n.j), rsum);
  }
  return heat;
}

const key=(i,j)=>`${i}:${j}`;

function neighbors(i,j, lats, lngs){
  const res=[];
  for(let di=-1; di<=1; di++){
    for(let dj=-1; dj<=1; dj++){
      if(di===0 && dj===0) continue;
      const ii=i+di, jj=j+dj;
      if(ii<0 || ii>=lats.length || jj<0 || jj>=lngs.length) continue;
      const lat=lats[ii], lng=lngs[jj];
      if(!oceanBufferOK(lat,lng)) continue;
      if(!segmentOceanOK(lats[i], lngs[j], lat, lng)) continue;
      res.push([ii,jj]);
    }
  }
  return res;
}

function aStar(origin, dest, grid, heat, p){
  const { lats, lngs } = grid;
  const s = closestIndex(origin, lats, lngs);
  const t = closestIndex(dest,   lats, lngs);
  if(!oceanBufferOK(thisLat(s,lats), thisLng(s,lngs)) || !oceanBufferOK(thisLat(t,lats), thisLng(t,lngs))) return null;

  const open = new Map(); const closed = new Set();
  const g = new Map();    const f = new Map(); const came = new Map();
  const heading = new Map();

  const sKey = key(s.i,s.j);
  g.set(sKey,0); f.set(sKey, heuristic(s,t,lats,lngs)); open.set(sKey,0);

  while(open.size){
    let curKey=null, bestF=Infinity;
    for(const k of open.keys()){
      const fv=f.get(k) ?? Infinity;
      if(fv<bestF){ bestF=fv; curKey=k; }
    }
    open.delete(curKey); closed.add(curKey);
    const [ci,cj]=curKey.split(':').map(Number);
    if(ci===t.i && cj===t.j){ return reconstruct(came, curKey, lats, lngs); }

    for(const [ni,nj] of neighbors(ci,cj,lats,lngs)){
      const nbKey=key(ni,nj); if(closed.has(nbKey)) continue;
      const stepDist = haversine([lats[ci],lngs[cj]],[lats[ni],lngs[nj]]);
      const risk = heat.get(nbKey) ?? 0;
      const turn = turningPenalty(heading.get(curKey), [ni-ci, nj-cj]);
      const mid = [(lats[ci]+lats[ni])/2, (lngs[cj]+lngs[nj])/2];
      const coast = coastPenalty(mid[0], mid[1]);
      const stepCost = p.wDist*stepDist + p.wRisk*risk + p.wTurn*turn + p.wCoast*coast;
      const tentative = (g.get(curKey) ?? Infinity) + stepCost;

      if(tentative < (g.get(nbKey) ?? Infinity)){
        came.set(nbKey, curKey); g.set(nbKey, tentative);
        // FIXED: j: nj (not j=nj)
        f.set(nbKey, tentative + heuristic({ i: ni, j: nj }, t, lats, lngs));
        open.set(nbKey,0); heading.set(nbKey,[ni-ci,nj-cj]);
      }
    }
  }
  return null;
}

const heuristic=(a,b,l,g)=>haversine([thisLat(a,l), thisLng(a,g)], [thisLat(b,l), thisLng(b,g)]);
const thisLat=(o,l)=> typeof o.lat==='number'?o.lat: l[o.i];
const thisLng=(o,g)=> typeof o.lng==='number'?o.lng: g[o.j];

function turningPenalty(prevVec, curVec){
  if(!prevVec) return 0;
  const [ax,ay]=prevVec, [bx,by]=curVec;
  const dot=ax*bx+ay*by;
  const la=Math.hypot(ax,ay)||1, lb=Math.hypot(bx,by)||1;
  const cos=Math.max(-1,Math.min(1, dot/(la*lb)));
  const angle=Math.acos(cos);
  return angle*10;
}

function reconstruct(came, curKey, lats, lngs){
  const rev=[];
  while(curKey){
    const [i,j]=curKey.split(':').map(Number);
    rev.push([lats[i], lngs[j]]);
    curKey = came.get(curKey);
  }
  rev.reverse();
  const sm=[rev[0]];
  for(let k=1;k<rev.length-1;k++){
    const A=sm.at(-1), B=rev[k], C=rev[k+1];
    const ang = angleABC(A,B,C);
    if(ang>0.02) sm.push(B);
  }
  sm.push(rev.at(-1));
  return sm;
}
function angleABC(A,B,C){
  const v1=[B[0]-A[0],B[1]-A[1]], v2=[C[0]-B[0],C[1]-B[1]];
  const dot=v1[0]*v2[0]+v1[1]*v2[1];
  const l1=Math.hypot(v1[0],v1[1])||1, l2=Math.hypot(v2[0],v2[1])||1;
  const cos=Math.max(-1,Math.min(1,dot/(l1*l2)));
  return Math.acos(cos);
}
function closestIndex(pt, lats, lngs){
  let bi=0,bj=0, bd=Infinity;
  for(let i=0;i<lats.length;i++){
    for(let j=0;j<lngs.length;j++){
      const lat=lats[i], lng=lngs[j];
      if(!oceanBufferOK(lat,lng)) continue;
      const d=haversine(pt,[lat,lng]);
      if(d<bd){ bd=d; bi=i; bj=j; }
    }
  }
  return {i:bi, j:bj};
}
function haversine(a,b){
  const R=6371;
  const dLat=(b[0]-a[0]) * Math.PI/180, dLng=(b[1]-a[1]) * Math.PI/180;
  const lat1=a[0]*Math.PI/180, lat2=b[0]*Math.PI/180;
  const h=(Math.sin(dLat/2)**2)+Math.cos(lat1)*Math.cos(lat2)*(Math.sin(dLng/2)**2);
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
