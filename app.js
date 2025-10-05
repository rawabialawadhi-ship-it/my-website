import L from "https://cdn.skypack.dev/leaflet@1.9.4";

/* ===================== Map Init (NASA GIBS) ===================== */
const map = L.map("map", {
  worldCopyJump: true,
  zoomControl: true,
  center: [26.3, 51.5],
  zoom: 5,
  minZoom: 2,
  maxZoom: 9
});

// Build “yesterday (UTC)” date string => full mosaic (avoids black swath edges)
function gibsDateUTCMinus(days=1){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
const GIBS_TIME = gibsDateUTCMinus(1);
const GIBS_SUB = ["a","b","c"];
const GIBS_TM = "GoogleMapsCompatible_Level9";

// Panes for clean stacking
map.createPane('gibs-base');    map.getPane('gibs-base').style.zIndex = 200;
map.createPane('gibs-coast');   map.getPane('gibs-coast').style.zIndex = 320;
map.createPane('gibs-feat');    map.getPane('gibs-feat').style.zIndex = 340;
map.createPane('gibs-labels');  map.getPane('gibs-labels').style.zIndex = 360;

// Base: VIIRS Corrected Reflectance (True Color)
const gibsTrueColor = L.tileLayer(
  `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${GIBS_TIME}/${GIBS_TM}/{z}/{y}/{x}.jpg`,
  { subdomains:GIBS_SUB, tileSize:256, maxZoom:9, pane:'gibs-base', attribution:"Imagery © NASA GIBS / Worldview", noWrap:true }
).addTo(map);

// Transparent overlays
const gibsCoastlines = L.tileLayer(
  `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/Coastlines/default/${GIBS_TIME}/${GIBS_TM}/{z}/{y}/{x}.png`,
  { subdomains:GIBS_SUB, tileSize:256, maxZoom:9, pane:'gibs-coast', opacity:1, noWrap:true }
).addTo(map);

const gibsFeatures = L.tileLayer(
  `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Features/default/${GIBS_TIME}/${GIBS_TM}/{z}/{y}/{x}.png`,
  { subdomains:GIBS_SUB, tileSize:256, maxZoom:9, pane:'gibs-feat', opacity:1, noWrap:true }
).addTo(map);

const gibsLabels = L.tileLayer(
  `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/Reference_Labels/default/${GIBS_TIME}/${GIBS_TM}/{z}/{y}/{x}.png`,
  { subdomains:GIBS_SUB, tileSize:256, maxZoom:9, pane:'gibs-labels', opacity:1, noWrap:true }
).addTo(map);

/* ===================== Config ===================== */
const FUEL_BURN = { small: 80, medium: 150, large: 250 }; // kg/km (demo)
const DEFAULT_KTS = 16;
const FLEET_SIZE = 100; // “100 captains”

/* ===================== DOM ===================== */
const form = document.getElementById("route-form");
const fromInput = document.getElementById("from-input");
const toInput   = document.getElementById("to-input");
const swapBtn = document.getElementById("swap-btn");
const shipSizeSel = document.getElementById("ship-size");
const fuelTankInput = document.getElementById("fuel-tank");

const hazardListEl = document.getElementById("hazard-list");
const pillInfo = document.getElementById("pill-info");
const statusETA = document.getElementById("status-eta");
const statusDist = document.getElementById("status-distance");
const statusFuel = document.getElementById("status-fuel");
const statusFuelLeft = document.getElementById("status-fuel-left");

const gibsToggle   = document.getElementById("layer-gibs");
const coastToggle  = document.getElementById("layer-coast");
const featToggle   = document.getElementById("layer-feat");
const labelsToggle = document.getElementById("layer-labels");

const riskModal = document.getElementById("risk-modal");
const riskDistanceEl = document.getElementById("risk-distance");
const riskPercentEl = document.getElementById("risk-percent");
const riskTypeEl = document.getElementById("risk-type");
const gptAddendumEl = document.getElementById("gpt-addendum");

const btnAI = document.getElementById("btn-ai");
const btnOpenReroute = document.getElementById("btn-open-reroute");

/* ===================== Demo Hazards ===================== */
const hazardIcon = (color)=> L.divIcon({
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};outline:2px solid rgba(255,255,255,.65);"></div>`,
  className:"", iconSize:[14,14]
});
const hazards = {
  waves: [
    { id:"W1", type:"High waves", lat:26.3, lng:50.9, r:120, risk:0.65 },
    { id:"W2", type:"High waves", lat:25.3, lng:52.4, r:90,  risk:0.55 }
  ],
  storms: [{ id:"S1", type:"Storm cell", lat:25.6, lng:51.2, r:140, risk:0.88 }]
};

/* ===================== Layers ===================== */
const routeLayer  = L.layerGroup().addTo(map); // baseline or “best” route
const altLayer    = L.layerGroup().addTo(map); // “fleet” alternatives
const hazardLayer = L.layerGroup().addTo(map);

/* ===================== Ports Index (subset for demo) ===================== */
const PORTS = [
  { name:"Port of Shuwaikh (Kuwait)", country:"Kuwait",   lat:29.367, lng:47.933 },
  { name:"Hamad Port (Qatar)",        country:"Qatar",    lat:25.015, lng:51.605 },
  { name:"Port of Singapore",         country:"Singapore",lat:1.265,  lng:103.823 },
  { name:"Port of Jebel Ali",         country:"UAE",      lat:25.010, lng:55.061 },
  { name:"Port of Dammam",            country:"Saudi Arabia", lat:26.512, lng:50.215 },
  { name:"Port of Sohar",             country:"Oman",     lat:24.494, lng:56.637 },
  { name:"Port of Kuwait Shuaiba",    country:"Kuwait",   lat:29.066, lng:48.151 },
  { name:"Doha Port",                 country:"Qatar",    lat:25.288, lng:51.545 },
  { name:"Port of Antwerp",           country:"Belgium",  lat:51.270, lng:4.404 },
  { name:"Port of Rotterdam",         country:"Netherlands", lat:51.955, lng:4.125 }
];

/* ===================== State ===================== */
let currentRoute = []; // [[lat,lng], ...] baseline
let lastAIPath = null;
let lastStats = null;

/* ===================== Utils ===================== */
function haversine(a,b){
  const R = 6371;
  const dLat = (b[0]-a[0]) * Math.PI/180;
  const dLng = (b[1]-a[1]) * Math.PI/180;
  const lat1 = a[0]*Math.PI/180;
  const lat2 = b[0]*Math.PI/180;
  const h = (Math.sin(dLat/2) ** 2) + Math.cos(lat1)*Math.cos(lat2)*(Math.sin(dLng/2) ** 2);
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}
function totalDistanceKm(route){ let d=0; for(let i=0;i<route.length-1;i++) d+=haversine(route[i],route[i+1]); return d; }
function estimateETA(distKm, speedKts=DEFAULT_KTS){
  const hours = distKm/(speedKts*1.852);
  const h = Math.floor(hours);
  const m = Math.round((hours-h)*60);
  return `${h}h ${m}m @${speedKts} kts`;
}
function pill(text){ pillInfo.textContent = text; pillInfo.style.opacity = 1; setTimeout(()=>{pillInfo.style.opacity=0.9}, 1200); }
function burnPerKmBySize(size){ return FUEL_BURN[size] ?? FUEL_BURN.medium; }
function kgFromTons(tons){ return tons * 1_000; }

function drawRoute(route, color="#60ffa6", weight=4, opacity=0.95){
  routeLayer.clearLayers();
  const poly = L.polyline(route.map(([a,b])=>L.latLng(a,b)), { color, weight, opacity });
  poly.addTo(routeLayer);
  L.circleMarker(route[0], { radius:6, color:"#fff", fillColor:"#2ad2ff", fillOpacity:1 }).addTo(routeLayer).bindPopup("Origin");
  L.circleMarker(route.at(-1), { radius:6, color:"#fff", fillColor:"#ffd166", fillOpacity:1 }).addTo(routeLayer).bindPopup("Destination");
  map.fitBounds(poly.getBounds(), { padding: [20,20] });
}

function renderHazards(){
  hazardLayer.clearLayers();
  const items=[];
  [...hazards.waves, ...hazards.storms].forEach(h=>{
    const color = h.type.includes("wave") ? "#6bd1ff" : "#ff6b6b";
    L.circle([h.lat,h.lng],{radius:h.r*1000,color,weight:1.25,fillColor:color,fillOpacity:0.15}).addTo(hazardLayer);
    L.marker([h.lat,h.lng],{icon:hazardIcon(color)}).addTo(hazardLayer).bindPopup(`${h.type} • Risk ${Math.round(h.risk*100)}%`);
    items.push(h);
  });
  renderHazardList(items);
}
function renderHazardList(list){
  hazardListEl.innerHTML="";
  if(!list.length){
    hazardListEl.classList.add("empty");
    hazardListEl.textContent="No hazards loaded.";
    return;
  }
  hazardListEl.classList.remove("empty");
  list.forEach(h=>{
    const row=document.createElement("div");
    row.className="hazard";
    const riskPct=Math.round(h.risk*100);
    row.innerHTML = `<div><div class="type">${h.type}</div><div class="id" style="opacity:.7">ID: ${h.id}</div></div><div class="risk">Risk: ${riskPct}%</div>`;
    hazardListEl.appendChild(row);
  });
}
function updateStats(route){
  const distKm = totalDistanceKm(route);
  const burn = burnPerKmBySize(shipSizeSel.value);
  const fuelUsedKg = Math.round(distKm * burn);
  const tankKg = kgFromTons(parseFloat(fuelTankInput.value || "0"));
  const fuelLeftKg = Math.max(0, tankKg - fuelUsedKg);
  statusDist.textContent = `${Math.round(distKm).toLocaleString()} km`;
  statusETA.textContent  = estimateETA(distKm);
  statusFuel.textContent = `${fuelUsedKg.toLocaleString()} kg`;
  statusFuelLeft.textContent = `${fuelLeftKg.toLocaleString()} kg`;
  lastStats = { distKm, etaText: estimateETA(distKm), fuelUsedKg, fuelLeftKg };
}
function distancePointToSegmentKm(P, A, B, samples=16){
  let minD = Infinity;
  for(let i=0;i<=samples;i++){
    const t = i/samples;
    const C = [ A[0] + t*(B[0]-A[0]), A[1] + t*(B[1]-A[1]) ];
    minD = Math.min(minD, haversine(P, C));
  }
  return minD;
}

/* ===== Risk helpers ===== */
function gaussianRiskAt(point, hazard){
  const d = haversine(point, [hazard.lat, hazard.lng]);
  const R = hazard.r || 100, sigma = Math.max(20, R*0.8);
  const inside = d <= R*0.7;
  return inside ? 50 : (hazard.risk || 0.6) * Math.exp(-(d*d)/(2*sigma*sigma)) * 10;
}
function routeRiskIntegral(route){
  const all = [...hazards.waves, ...hazards.storms];
  let riskSum = 0;
  for(let i=0;i<route.length;i++){
    const p = route[i];
    for(const h of all){ riskSum += gaussianRiskAt(p, h); }
  }
  return riskSum / Math.max(1, route.length);
}
function analyzeRouteRisk(route){
  const all = [...hazards.waves, ...hazards.storms];
  let best = { hazard:null, distEdgeKm: Infinity };
  for(let i=0;i<route.length-1;i++){
    const A=route[i], B=route[i+1];
    for(const h of all){
      const dseg = distancePointToSegmentKm([h.lat,h.lng], A, B);
      const edge = dseg - h.r;
      if(edge < best.distEdgeKm){ best = { hazard: h, distEdgeKm: edge }; }
    }
  }
  let pct = 0;
  if (best.hazard){
    const proximity = Math.max(0, (best.hazard.r - Math.max(0, best.distEdgeKm)) / best.hazard.r);
    pct = Math.min(1, best.hazard.risk * (0.5 + proximity));
  }
  return { nearest: best, riskPercent: Math.round(pct * 100) };
}

/* ===================== Geocoding & Worldview URL support ===================== */
async function parseLatLngOrPort(text){
  const s = text.trim();

  // If it's a Worldview URL, extract c=lon,lat or v=bbox
  if (s.includes("worldview.earthdata.nasa.gov")) {
    try{
      const u = new URL(s);
      const c = u.searchParams.get("c");
      if (c) {
        const [lon, lat] = c.split(",").map(Number); // Worldview uses lon,lat
        if (isFinite(lat) && isFinite(lon)) return [lat, lon];
      }
      const v = u.searchParams.get("v"); // bbox: minLon,minLat,maxLon,maxLat
      if (v) {
        const [minLon,minLat,maxLon,maxLat] = v.split(",").map(Number);
        const lat = (minLat+maxLat)/2;
        const lon = (minLon+maxLon)/2;
        if (isFinite(lat) && isFinite(lon)) return [lat, lon];
      }
    }catch(_e){}
  }

  // Plain "lat,lon"
  const m = s.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
  if (m) return [parseFloat(m[1]), parseFloat(m[3])];

  // Known port names subset
  const t = s.toLowerCase();
  const hit = PORTS.find(p => p.name.toLowerCase().includes(t) || (p.country && t.includes(p.country.toLowerCase())));
  if (hit) return [hit.lat, hit.lng];

  // Fallback geocoding (Nominatim)
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(text)}`;
  const js = await fetch(url, { headers: { "Accept": "application/json" }}).then(r=>r.json());
  if(!js?.length) throw new Error("Place not found");
  const rec = js[0];
  const lat = parseFloat(rec.lat), lon = parseFloat(rec.lon);

  // If a country or big city: snap to nearest known port
  const isCountry = rec.class === "boundary" && rec.type === "administrative" && rec.address?.country;
  const isCity = rec.class === "place" && (rec.type === "city" || rec.type === "town" || rec.type === "village");
  if(isCountry || isCity){
    const nearest = nearestPort([lat,lon]);
    return [nearest.lat, nearest.lng];
  }
  return [lat, lon];
}
function nearestPort([lat, lon]){
  let best = PORTS[0], bd = Infinity;
  for(const p of PORTS){
    const d = haversine([lat,lon], [p.lat,p.lng]);
    if(d<bd){ bd=d; best=p; }
  }
  return best;
}

/* ===================== AI Worker ===================== */
let aiWorker = new Worker('ai-worker.js', { type: 'module' });
function routeBounds(route, pad=10){
  let minLat= Infinity, maxLat=-Infinity, minLng= Infinity, maxLng=-Infinity;
  route.forEach(([lat,lng])=>{
    minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
    minLng=Math.min(minLng,lng); maxLng=Math.max(maxLng,lng);
  });
  return { minLat:minLat-pad, maxLat:maxLat+pad, minLng:minLng-pad, maxLng:maxLng+pad };
}
function planOnce({origin, dest, hazards, mode, riskWeight, stepDeg, bounds}){
  return new Promise(resolve=>{
    const handle = (e)=>{
      if(e.data?.type === 'ai_path'){
        aiWorker.removeEventListener('message', handle);
        resolve(e.data.path || null);
      }
    };
    aiWorker.addEventListener('message', handle, { once:true });
    aiWorker.postMessage({ type:'plan', origin, dest, hazards, mode, riskWeight, stepDeg, bounds });
  });
}

/* ===================== “100 Captains” Fleet Simulation ===================== */
function buildFleetProfiles(n){
  const modes = [
    ...Array(Math.round(n*0.40)).fill('safest'),
    ...Array(Math.round(n*0.35)).fill('balanced'),
    ...Array(Math.round(n*0.15)).fill('fuel'),
    ...Array(n - (Math.round(n*0.40)+Math.round(n*0.35)+Math.round(n*0.15))).fill('fastest'),
  ];
  return modes.map((mode, idx)=>({
    id: idx+1, mode,
    riskWeight: mode==='safest' ? 1.6 + Math.random()*0.6
               : mode==='balanced'? 1.0 + Math.random()*0.6
               : mode==='fuel'    ? 0.8 + Math.random()*0.4
                                   : 0.6 + Math.random()*0.3,
    stepDeg: 0.24 + Math.random()*0.16,
    pad: 10 + Math.floor(Math.random()*6),
  }));
}
async function aiFleetRecalculate(){
  if(!currentRoute.length){
    alert("Enter From/To and click Route first.");
    return;
  }
  pill("AI Recalculate: consulting 100 captains…");
  const origin = currentRoute[0];
  const dest   = currentRoute.at(-1);
  const baseBounds = routeBounds(currentRoute, 12);
  const activeHaz = [...hazards.waves, ...hazards.storms];

  altLayer.clearLayers();
  const profiles = buildFleetProfiles(FLEET_SIZE);
  const results = [];

  for(const p of profiles){
    const b = { ...baseBounds };
    b.minLat -= (p.pad-12); b.maxLat += (p.pad-12);
    b.minLng -= (p.pad-12); b.maxLng += (p.pad-12);

    const path = await planOnce({
      origin, dest, hazards: activeHaz, mode: p.mode, riskWeight: p.riskWeight, stepDeg: p.stepDeg, bounds: b
    });

    if(path && path.length>1){
      const dKm = totalDistanceKm(path);
      const rISK = routeRiskIntegral(path);
      const score = 3.0*rISK + 0.02*dKm;
      results.push({ profile:p, path, dKm, rISK, score });
      L.polyline(path, { color:"#2ae6b1", weight:3, opacity:0.20 }).addTo(altLayer);
    }
  }

  if(!results.length){ alert("No ocean-only path found."); return; }

  results.sort((a,b)=>a.score-b.score);
  const best = results[0];
  lastAIPath = best.path;
  drawRoute(best.path, "#15e1b6", 5, 0.98);
  updateStats(best.path);

  const pctSafest = Math.round(100*results.filter(r=>r.profile.mode==='safest').length / results.length);
  pill(`Fleet consensus selected a safe route • ${results.length}/${profiles.length} valid • distance ${Math.round(best.dKm)} km`);

  const risk = analyzeRouteRisk(best.path);
  if(risk.nearest.hazard && (risk.nearest.distEdgeKm < 25 || risk.riskPercent >= 50)){
    riskDistanceEl.textContent = (risk.nearest.distEdgeKm <= 0)
      ? `Inside by ${Math.abs(Math.round(risk.nearest.distEdgeKm))} km`
      : `${Math.round(risk.nearest.distEdgeKm)} km`;
    riskPercentEl.textContent = `${risk.riskPercent}%`;
    riskTypeEl.textContent = risk.nearest.hazard.type;
    gptAddendumEl.textContent = `Consensus favored staying clear: ${pctSafest}% of captains prioritized safety.`;
    riskModal.showModal();
  }
}

/* ===================== Events ===================== */
swapBtn.addEventListener("click", ()=>{
  const a = fromInput.value;
  fromInput.value = toInput.value;
  toInput.value = a;
});

[gibsToggle, coastToggle, featToggle, labelsToggle].forEach(el=>{
  if(!el) return;
  el.addEventListener("change", ()=>{
    if(el === gibsToggle){ toggleLayer(gibsTrueColor, gibsToggle.checked); }
    else if(el === coastToggle){ toggleLayer(gibsCoastlines, coastToggle.checked); }
    else if(el === featToggle){ toggleLayer(gibsFeatures, featToggle.checked); }
    else if(el === labelsToggle){ toggleLayer(gibsLabels, labelsToggle.checked); }
  });
});
function toggleLayer(layer, on){
  if(on){ if(!map.hasLayer(layer)) layer.addTo(map); }
  else { if(map.hasLayer(layer)) map.removeLayer(layer); }
}

btnAI.addEventListener("click", aiFleetRecalculate);

btnOpenReroute.addEventListener("click", (e)=>{
  e.preventDefault();
  if(!lastAIPath){
    aiFleetRecalculate();
    pill("Calculating AI route…");
    setTimeout(openReroutePage, 1200);
  } else {
    openReroutePage();
  }
});

form.addEventListener("submit", async (ev)=>{
  ev.preventDefault();
  try{
    const [origLat, origLng] = await parseLatLngOrPort(fromInput.value);
    const [destLat, destLng] = await parseLatLngOrPort(toInput.value);
    currentRoute = interpolateLine([origLat,origLng], [destLat,destLng], 8);
    drawRoute(currentRoute, "#60ffa6");
    renderHazards();
    updateStats(currentRoute);
    pill("Baseline route ready. Click AI Recalculate to avoid hazards.");
  }catch(e){
    alert("Routing error: " + e.message);
  }
});

/* ===================== Helpers ===================== */
function interpolateLine(A, B, steps=8){
  const out = [];
  for(let t=0;t<=steps;t++){
    const f = t/steps;
    out.push([ A[0] + f*(B[0]-A[0]), A[1] + f*(B[1]-A[1]) ]);
  }
  return out;
}
function openReroutePage(){
  if(!lastAIPath) { alert("AI route not ready yet."); return; }
  sessionStorage.setItem("ai_path", JSON.stringify(lastAIPath));
  sessionStorage.setItem("ai_stats", JSON.stringify(lastStats));
  sessionStorage.setItem("ship_size", shipSizeSel.value);
  sessionStorage.setItem("fuel_tank_tons", fuelTankInput.value);
  window.open("reroute.html", "_blank");
}

/* ===================== Initial ===================== */
renderHazards();
pill("Paste Worldview links or lat,lon • Route → then AI Recalculate.");
