'use strict';
const $=s=>document.querySelector(s);
const ld=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}};
const sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fm=m=>m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m';
const S={bb:[14.838,120.277,14.862,120.307],poly:null,V:new Map(),E:[],rep:{},areas:[],cen:[],activeReports:[],start:null,mode:null,key:undefined,loadError:null,loading:false,drawing:[],reportDraft:null,submitted:0,locationRequest:0};

const hav=(a,b)=>{const R=6371000,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r,x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
class Heap{constructor(){this.a=[]}get n(){return this.a.length}push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[p],a[i]]=[a[i],a[p]];i=p}}pop(){const a=this.a,t=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let c=2*i+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[i][0]<=a[c][0])break;[a[i],a[c]]=[a[c],a[i]];i=c}}return t}}
function dij(src,w){const dist=new Map([[src,0]]),prev=new Map(),done=new Set(),h=new Heap();h.push([0,src]);while(h.n){const[d,u]=h.pop();if(done.has(u))continue;done.add(u);for(const e of S.V.get(u).adj){const x=w(e);if(x===Infinity)continue;const v=e.a===u?e.b:e.a,nd=d+x;if(nd<(dist.get(v)??Infinity)){dist.set(v,nd);prev.set(v,[u,e]);h.push([nd,v])}}}return{dist,prev}}
function best(result,centers){let selected=null;for(const c of centers){const d=result.dist.get(c.vid);if(d!==undefined&&(!selected||d<selected.d))selected={c,d}}if(!selected)return null;const edges=[];let v=selected.c.vid;while(result.prev.has(v)){const[u,e]=result.prev.get(v);edges.unshift(e);v=u}return{...selected,ed:edges}}
function plan(v,centers){const safe=dij(v,e=>stOf(e)==='ok'?e.len:Infinity),regular=dij(v,e=>e.len);return{safe:best(safe,centers),regular:best(regular,centers)}}
const map=L.map('map',{preferCanvas:true,zoomControl:false}).setView([14.8485,120.2918],15);
L.control.zoom({position:'topright'}).addTo(map);
const osm=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abc',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const carto=L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd',attribution:'&copy; OpenStreetMap contributors &copy; CARTO'});
let tilesFailedOver=false;
osm.on('tileerror',()=>{if(tilesFailedOver)return;tilesFailedOver=true;map.removeLayer(osm);carto.addTo(map)});
const cv=L.canvas({tolerance:9}),svg=L.svg();
const LG={roads:L.layerGroup().addTo(map),hazards:L.layerGroup().addTo(map),route:L.layerGroup().addTo(map),centers:L.layerGroup().addTo(map),user:L.layerGroup().addTo(map),areas:L.layerGroup().addTo(map),boundary:L.layerGroup().addTo(map),drawing:L.layerGroup().addTo(map)};
const color={ok:'#64748b',flooded:'#2563eb',blocked:'#dc2626'};
const legend=L.control({position:'bottomright'});legend.onAdd=()=>{const el=L.DomUtil.create('div','leg');el.innerHTML='<b>Map key</b><br><i style="background:#16a34a"></i>Safest route<br><i class="pin" style="background:#d97706"></i>Evacuation center<br><i class="pin" style="background:#2563eb"></i>Your location<br><i style="background:#2563eb"></i>Flooded road<br><i style="background:#dc2626"></i>Blocked road';return el};legend.addTo(map);
const stOf=e=>Object.hasOwn(S.rep,e.id)?S.rep[e.id].condition:(S.areas.find(a=>a.edgeIds.includes(e.id))?.condition||'ok');
const style=e=>{const state=stOf(e);return{color:color[state],weight:state==='ok'?2:6,opacity:state==='ok'?.32:1}};
const toast=message=>{const el=$('#toast');el.textContent=message;el.classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('on'),3600)};
const setStatus=text=>{$('#stt').textContent=text;$('#dot').classList.remove('live','failed')};
const splash=loading=>$('#dot').classList.toggle('live',!loading);
const card=(cls,html)=>`<div class="empty ${cls}">${html}</div>`;

async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({error:'The server returned an invalid response.'}));
    if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);
    return data;
  }finally{clearTimeout(timer)}
}
async function overpass(query){
  const endpoints=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  try{
    return await Promise.any(endpoints.map(async endpoint=>{
      const response=await fetch(`${endpoint}?data=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(18000)});
      if(!response.ok)throw new Error(`Road-data service returned ${response.status}.`);
      const data=await response.json();if(!Array.isArray(data.elements))throw new Error('Road-data service returned an invalid response.');return data;
    }));
  }catch{throw new Error('Could not load the road network. Check the connection and retry.')}
}
function build(ways){
  S.V=new Map();S.E=[];const counts=new Map();
  ways.forEach(w=>w.nodes.forEach((id,i)=>counts.set(id,(counts.get(id)||0)+((i===0||i===w.nodes.length-1)?2:1))));
  const vertex=(id,p)=>{if(!S.V.has(id))S.V.set(id,{id,lat:p[0],lon:p[1],adj:[]});return S.V.get(id)};
  ways.forEach(w=>{let last=0;for(let i=1;i<w.nodes.length;i++)if(counts.get(w.nodes[i])>=2||i===w.nodes.length-1){
    const points=w.geometry.slice(last,i+1);let length=0;
    for(let k=1;k<points.length;k++)length+=hav({lat:points[k-1][0],lon:points[k-1][1]},{lat:points[k][0],lon:points[k][1]});
    const a=vertex(w.nodes[last],w.geometry[last]),b=vertex(w.nodes[i],w.geometry[i]);
    if(a!==b&&length>0){const edge={id:`${w.id}_${last}`,a:a.id,b:b.id,len:length,name:w.name,pts:points};S.E.push(edge);a.adj.push(edge);b.adj.push(edge)}
    last=i;
  }});
  for(const[id,v]of S.V)if(!v.adj.length)S.V.delete(id);
}
function nearest(p){let selected=null,distance=Infinity;for(const v of S.V.values()){const d=hav(p,v);if(d<distance){selected=v;distance=d}}return{v:selected,d:distance}}
function inCoverage(p){return p.lat>=S.bb[0]&&p.lat<=S.bb[2]&&p.lon>=S.bb[1]&&p.lon<=S.bb[3]}
function nearestEdge(p,max=Infinity){let selected=null;for(const e of S.E){let d=Infinity;for(let i=1;i<e.pts.length;i++){const a=e.pts[i-1],b=e.pts[i],length=hav({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]}),steps=Math.max(1,Math.ceil(length/10));for(let j=0;j<=steps;j++){const t=j/steps;d=Math.min(d,hav(p,{lat:a[0]+(b[0]-a[0])*t,lon:a[1]+(b[1]-a[1])*t}))}}if(d<=(selected?selected.d:max))selected={e,d}}return selected}
function inPolygon(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>point.lat)!==(yj>point.lat)&&point.lon<(xj-xi)*(point.lat-yi)/(yj-yi)+xi)inside=!inside}return inside}
function inArea(edge,points){const ring=points.map(([lat,lon])=>[lon,lat]);for(let i=1;i<edge.pts.length;i++){const a=edge.pts[i-1],b=edge.pts[i],length=hav({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]}),steps=Math.max(1,Math.ceil(length/15));for(let j=0;j<=steps;j++){const t=j/steps;if(inPolygon({lat:a[0]+(b[0]-a[0])*t,lon:a[1]+(b[1]-a[1])*t},ring))return true}}return false}
function installPublicState(data){
  S.activeReports=Array.isArray(data.reports)?data.reports:[];
  S.cen=(Array.isArray(data.centers)?data.centers:[]).filter(c=>Number.isFinite(+c.lat)&&Number.isFinite(+c.lon)).map(c=>({...c,lat:+c.lat,lon:+c.lon}));
  S.cen.forEach(c=>{const n=nearest(c);if(n.v)c.vid=n.v.id});
  S.rep={};S.areas=[];
  S.activeReports.forEach(report=>{
    if(report.kind==='road'){
      const n=nearestEdge({lat:+report.lat,lon:+report.lon},60);
      if(n&&!Object.hasOwn(S.rep,n.e.id))S.rep[n.e.id]={condition:report.condition};
    }else if(report.kind==='area'&&Array.isArray(report.points)&&report.points.length>=3){
      S.areas.push({condition:report.condition,points:report.points,edgeIds:S.E.filter(edge=>inArea(edge,report.points)).map(edge=>edge.id)});
    }
  });
}
function drawRoads(){
  LG.roads.clearLayers();
  S.E.forEach(e=>{e.layer=L.polyline(e.pts,{renderer:cv,...style(e)}).addTo(LG.roads);
    e.layer.on('click',event=>{L.DomEvent.stopPropagation(event);if(S.mode)onMap(event.latlng.lat,event.latlng.lng);else popup(e,event.latlng)});
    e.layer.on('mouseover',()=>{if(!S.mode)e.layer.setStyle({weight:8,opacity:1,color:'#0f766e'})});
    e.layer.on('mouseout',()=>e.layer.setStyle(style(e)));
    e.layer.bindTooltip(esc(e.name),{sticky:true,className:'rt',direction:'top',opacity:1});
  });
}
function paintHazards(){
  LG.hazards.clearLayers();
  S.E.forEach(e=>{const state=stOf(e);e.layer?.setStyle(style(e));if(state!=='ok')L.polyline(e.pts,{renderer:svg,interactive:false,className:'pulse',color:color[state],weight:13,opacity:.32}).addTo(LG.hazards)});
  S.activeReports.filter(report=>report.kind==='road').forEach(report=>L.circleMarker([report.lat,report.lon],{radius:6,color:'#fff',weight:2,fillColor:color[report.condition],fillOpacity:1}).bindTooltip(`${report.condition==='blocked'?'Blocked':'Flooded'} road · verified`).addTo(LG.hazards));
}
function popup(e,location){const state=stOf(e)==='ok'?'No active verified hazard report':`${stOf(e)} · verified report`;L.popup({closeButton:false}).setLatLng(location).setContent(`<b>${esc(e.name)}</b><small>${fm(e.len)} segment · ${state}</small>`).openOn(map)}
function drawCenters(){
  LG.centers.clearLayers();
  S.cen.forEach(center=>L.marker([center.lat,center.lon],{icon:L.divIcon({className:'',html:'<div class="cm"><span>E</span></div>',iconSize:[34,34],iconAnchor:[17,31]})}).bindTooltip(esc(center.name)).bindPopup(`<b>${esc(center.name)}</b><br><small>Barangay-verified evacuation center</small>`).addTo(LG.centers));
}
function drawAreas(){LG.areas.clearLayers();S.areas.forEach(area=>L.polygon(area.points,{color:color[area.condition],weight:2,fillColor:color[area.condition],fillOpacity:.2,interactive:false}).addTo(LG.areas))}
function drawDraft(){
  LG.drawing.clearLayers();if(!S.drawing.length)return;
  const coords=S.drawing.map(p=>[p.lat,p.lng]);
  if(coords.length>1)L.polyline(coords,{color:'#0f766e',weight:3,dashArray:'7 7',interactive:false}).addTo(LG.drawing);
  S.drawing.forEach(p=>L.circleMarker(p,{radius:5,color:'#fff',weight:2,fillColor:'#0f766e',fillOpacity:1,interactive:false}).addTo(LG.drawing));
}
function setStart(lat,lon,accuracy=0){
  const location={lat,lon},n=nearest(location),accurate=!accuracy||accuracy<=1000;LG.user.clearLayers();S.start={...location,accuracy,v:inCoverage(location)&&accurate&&n.v&&n.d<=1000?n.v.id:null};
  if(accuracy>0)L.circle([lat,lon],{radius:accuracy,color:'#2563eb',weight:1,fillColor:'#3b82f6',fillOpacity:.12,interactive:false}).addTo(LG.user);
  const marker=L.marker([lat,lon],{draggable:true,icon:L.divIcon({className:'',html:'<div class="user-pin"><span class="user-pulse"></span><svg viewBox="0 0 40 44" aria-hidden="true"><path d="M20 1C9.5 1 2 8.6 2 18c0 12.2 18 25 18 25s18-12.8 18-25C38 8.6 30.5 1 20 1z" fill="#2563eb" stroke="white" stroke-width="2.5"/><circle cx="20" cy="18" r="6" fill="white"/><circle cx="20" cy="18" r="3" fill="#1d4ed8"/></svg></div>',iconSize:[40,44],iconAnchor:[20,42]})}).addTo(LG.user);
  marker.bindTooltip('Your location · stored only in this browser').bindPopup(`<b>Your location</b><br><small>${lat.toFixed(5)}, ${lon.toFixed(5)}${accuracy>0?` · accuracy ±${Math.round(accuracy)} m`:''}</small>`).on('dragend',event=>{const p=event.target.getLatLng();setStart(p.lat,p.lng)});
  $('#locReadout').hidden=false;$('#locReadout').textContent=`Pinned here${accuracy>0?` · GPS accuracy ±${Math.round(accuracy)} m`:''}`;
  $('#gpsHint').textContent='Your location is shown on this device only.';
  if(accuracy>1000)toast('GPS accuracy is too low to calculate a safe route. Pick your location on the map.');
  else if(!inCoverage(location)||n.v&&n.d>1000)toast('Your location is outside the mapped barangay. SAFEPATH can route only from within Sta. Rita.');
  else if(n.v&&n.d>300)toast(`Your pin is ${Math.round(n.d)} m from the nearest mapped road.`);
  refresh();
}
function setLocation(){
  if(!navigator.geolocation){toast('Location is not supported on this device. Pick your location on the map.');return}
  if(!window.isSecureContext){$('#gpsHint').textContent='GPS requires HTTPS or localhost. Pick your location on the map, or open this app over HTTPS.';toast('GPS requires HTTPS or localhost. You can still pick your location on the map.');return}
  const requestId=++S.locationRequest,button=$('#bGeo');button.disabled=true;button.textContent='Finding your location…';
  navigator.geolocation.getCurrentPosition(position=>{
    if(requestId!==S.locationRequest)return;
    button.disabled=false;button.textContent='Update my location';
    const lat=position.coords.latitude,lon=position.coords.longitude;
    if(!inCoverage({lat,lon})){button.textContent='Try location again';$('#gpsHint').textContent='Your location is outside Barangay Sta. Rita. Pick a point in the mapped area if you need a local route.';toast('SAFEPATH currently covers Barangay Sta. Rita only.');return}
    setStart(lat,lon,position.coords.accuracy);
    map.setView([lat,lon],16);
  },error=>{
    if(requestId!==S.locationRequest)return;
    button.disabled=false;button.textContent='Try location again';
    $('#gpsHint').textContent=error.code===1?'Location permission was not granted. Pick your location on the map instead.':'Could not get GPS. Pick your location on the map instead.';
    toast(error.code===1?'Allow location access in your browser, or pick your location on the map.':'GPS timed out. Pick your location on the map or try again.');
  },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
function mode(value,text){
  S.mode=S.mode===value?null:value;
  $('#map').classList.toggle('pick',!!S.mode);$('#banner').classList.toggle('on',!!S.mode);$('#finishArea').hidden=S.mode!=='areaDraw';
  if(S.mode){$('#bt').textContent=text;map.closePopup()}
}
function onMap(lat,lon){
  if(S.mode==='start'){setStart(lat,lon);mode('start');map.setView([lat,lon],16)}
  else if(S.mode==='areaDraw'){S.drawing.push(L.latLng(lat,lon));drawDraft()}
  else if(S.mode==='roadReport'){S.reportDraft={kind:'road',lat,lon};mode('roadReport');$('#roadDlg').classList.add('on')}
}
function openReportForm(kind,condition,location){
  S.reportDraft={kind,condition,...location};
  $('#reportKind').textContent=`${kind==='area'?'Area':'Road'} marked ${condition}. Barangay staff review reports before they affect safe routes.`;
  $('#reportDlg').classList.add('on');
}
function chooseCondition(kind,condition){
  if(kind==='area'){
    const points=S.reportDraft?.points;
    $('#areaDlg').classList.remove('on');
    if(points)openReportForm('area',condition,{points});
  }else{
    const location=S.reportDraft;
    $('#roadDlg').classList.remove('on');
    if(location)openReportForm('road',condition,{lat:location.lat,lon:location.lon});
  }
}
async function submitReport(event){
  event.preventDefault();if(!S.reportDraft)return;
  const button=$('#sendReport');button.disabled=true;const draft=S.reportDraft;
  const payload={kind:draft.kind,condition:draft.condition,name:$('#reportName').value.trim(),phone:$('#reportPhone').value.trim()};
  if(draft.kind==='road'){payload.lat=draft.lat;payload.lon=draft.lon}else payload.points=draft.points;
  try{
    const result=await request('/api/reports',{method:'POST',body:JSON.stringify(payload)});
    S.submitted++;$('#reportMessage').hidden=false;$('#reportMessage').textContent=`Report sent for barangay review. Reference: ${result.id.slice(0,8)}. It will affect routes only if approved.`;
    $('#reportForm').reset();$('#reportDlg').classList.remove('on');S.reportDraft=null;mode(null);toast('Report submitted for review.');
    $('#s2').classList.add('done');
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
}
function focusRoute(safe,regular){
  const bounds=L.latLngBounds([[S.start.lat,S.start.lon]]);
  (safe||regular).ed.forEach(edge=>edge.pts.forEach(point=>bounds.extend(point)));
  map.fitBounds(bounds,{paddingTopLeft:[innerWidth>860?450:24,70],paddingBottomRight:[24,innerWidth>860?40:innerHeight*.5],maxZoom:17});
}
function route(focus=false){
  LG.route.clearLayers();const out=$('#res');
  if(!S.start){S.key=undefined;$('#s1').classList.remove('done');$('#s3').classList.remove('done');out.innerHTML=card('w',`<b>Allow location to get started</b><span>Use “Find my location” and allow browser location access, or pick your location on the map.</span>${S.loadError?`<button class="b sm" data-action="retry" ${S.loading?'disabled':''}>${S.loading?'Loading…':'Retry map data'}</button>`:''}`);return}
  $('#s1').classList.add('done');
  if(!S.start.v||!S.V.has(S.start.v)){S.key=undefined;$('#s3').classList.remove('done');const detail=S.loadError?`Road data is unavailable: ${esc(S.loadError)}`:S.start.accuracy>1000?'GPS accuracy is too low. Pick your location on the map to get a route.':S.V.size?'This app covers Barangay Sta. Rita only. Pick a point inside the mapped area near a road.':'Waiting for road data to calculate your route.';out.innerHTML=card(S.loadError?'w':'',`<b>Your location is pinned</b><span>${detail}</span>${S.loadError?`<button class="b sm" data-action="retry" ${S.loading?'disabled':''}>${S.loading?'Loading…':'Retry map data'}</button>`:''}`);return}
  const centers=S.cen.filter(c=>c.vid!==undefined&&S.V.has(c.vid));
  if(!centers.length){S.key=undefined;$('#s3').classList.remove('done');out.innerHTML=card('w','<b>No evacuation centers registered yet</b><span>Please follow barangay emergency instructions. The nearest-center route will appear when verified locations are added.</span>');return}
  const result=plan(S.start.v,centers),safe=result.safe,regular=result.regular;
  if(!regular){S.key='none';$('#s3').classList.remove('done');out.innerHTML=card('b','<b>Location is not connected to a mapped road</b><span>Pick a point nearer to a road and try again.</span>');return}
  S.key=safe?safe.ed.map(e=>e.id).join():'none';$('#s3').classList.toggle('done',!!safe);
  const draw=(edges,options)=>edges.forEach(e=>L.polyline(e.pts,{renderer:svg,interactive:false,...options}).addTo(LG.route));
  if(safe){
    draw(safe.ed,{color:'#fff',weight:12,opacity:.98});draw(safe.ed,{color:'#16a34a',weight:7,opacity:1,className:'flow'});
    out.innerHTML=`<div class="hero"><small>NEAREST SAFE CENTER</small><div class="big" id="bigd">${fm(safe.d)}</div><div>to <b>${esc(safe.c.name)}</b></div><span class="badge ok">Route avoids verified hazards</span></div><button class="b p route-focus" id="showRoute">Show route on map</button>`;
    const distance=$('#bigd'),target=safe.d,start=performance.now();
    (function count(now){const ratio=Math.min(1,(now-start)/650);distance.textContent=fm(target*(1-Math.pow(1-ratio,3)));if(ratio<1)requestAnimationFrame(count)})(start);
    $('#showRoute').onclick=()=>focusRoute(safe,regular);
  }else{
    draw(regular.ed,{color:'#dc2626',weight:6,dashArray:'8 8',opacity:.85});
    out.innerHTML='<div class="hero bad"><small>NO VERIFIED SAFE ROUTE</small><div class="big">Route blocked</div><div>Every mapped route crosses a road reported as flooded or blocked. Follow barangay emergency instructions and do not enter floodwater.</div></div>';
  }
  if(focus)focusRoute(safe,regular);
}
function refresh(){
  paintHazards();drawAreas();drawCenters();
  $('#bRefreshMap').disabled=S.loading;
  const count=S.activeReports.length;
  $('#activeReports').innerHTML=count?`<div class="report-status"><b>${count} verified hazard ${count===1?'report':'reports'}</b><span>Shown on the map and used for safe routing. New community reports are reviewed before publication.</span></div>`:'<div class="report-status"><b>No verified hazard reports</b><span>Community reports are checked by barangay staff before they affect routes.</span></div>';
  $('#bNearest').disabled=!S.start?.v;
  $('#bNearest').textContent='Find nearest evacuation center';
  route();
}
async function load(force=false){
  const publicState=await request('/api/public');
  const cache=force?null:ld('sp_osm_v5',null);
  let ways=Array.isArray(cache?.ways)&&cache.ways.length?cache.ways:null;
  let source=ways?(cache.source||'Saved OpenStreetMap road data'):'';
  const[s,w,n,e]=S.bb;
  let updateError=null;
  if(!ways){
    const snapshot=await request('/road-network.json');
    if(!Array.isArray(snapshot.ways)||!snapshot.ways.length)throw new Error('The saved road map is unavailable.');
    ways=snapshot.ways;
    const date=new Date(snapshot.retrievedAt);
    source=`OpenStreetMap offline snapshot · ${Number.isNaN(date.getTime())?'date unknown':date.toLocaleDateString()}`;
  }
  if(force){
    setStatus('Checking for updated roads…');
    try{
      const data=await overpass(`[out:json][timeout:90];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|trunk_link|primary_link|secondary_link|tertiary_link)$"](${s},${w},${n},${e});out body geom;`);
      const updated=data.elements.filter(x=>x.type==='way'&&x.geometry&&x.geometry.every(p=>p)).map(x=>({id:x.id,name:x.tags.name||`Unnamed ${x.tags.highway} road`,nodes:x.nodes,geometry:x.geometry.map(p=>[+p.lat.toFixed(6),+p.lon.toFixed(6)])}));
      if(!updated.length)throw new Error('No road segments were returned.');
      ways=updated;source='Live OpenStreetMap road data';sv('sp_osm_v5',{ways,source});
    }catch(error){updateError=error}
  }
  build(ways);if(!S.V.size)throw new Error('No road segments were found for Barangay Sta. Rita.');
  $('#roadDataNote').textContent=updateError?`${source} · Could not refresh now. Try again when online.`:`${source}. Routes are advisory; follow barangay emergency instructions.`;
  installPublicState(publicState);drawRoads();
  if(S.start){const n=nearest(S.start);S.start.v=inCoverage(S.start)&&(!S.start.accuracy||S.start.accuracy<=1000)&&n.v&&n.d<=1000?n.v.id:null}
  LG.areas.clearLayers();
  LG.boundary.clearLayers();
  L.rectangle([[S.bb[0],S.bb[1]],[S.bb[2],S.bb[3]]],{color:'#0f766e',weight:1,fill:false,dashArray:'7 6',interactive:false}).addTo(LG.boundary);
  S.loadError=null;refresh();setStatus(updateError?'Saved map · online refresh unavailable':`Map ready · ${S.E.length.toLocaleString()} road segments`);splash(false);
}
async function startLoad(force=false){
  if(S.loading)return;S.loading=true;S.loadError=null;$('#bRefreshMap').textContent='Updating…';setStatus(force?'Refreshing road data…':'Loading road network…');refresh();
  try{await load(force)}catch(error){S.loadError=error.message||'Map data is unavailable.';setStatus('Road data unavailable');$('#dot').classList.add('failed');refresh()}
  finally{S.loading=false;$('#bRefreshMap').disabled=false;$('#bRefreshMap').textContent='Refresh map data';if(S.loadError)refresh()}
}

map.on('click',event=>{if(S.mode)onMap(event.latlng.lat,event.latlng.lng)});
$('#bGeo').onclick=setLocation;
$('#bStart').onclick=()=>{S.locationRequest++;$('#bGeo').disabled=false;$('#bGeo').textContent='Find my location';mode('start','Tap your current location on the map')};
$('#bNearest').onclick=()=>route(true);
$('#bRefreshMap').onclick=()=>startLoad(true);
$('#bRoad').onclick=()=>mode('roadReport','Tap the road you want to report');
$('#bArea').onclick=()=>{S.drawing=[];LG.drawing.clearLayers();mode('areaDraw','Tap around the area · add 3 or more points')};
$('#finishArea').onclick=()=>{if(S.drawing.length<3){toast('Add at least 3 points to outline the area.');return}const points=S.drawing.map(p=>[p.lat,p.lng]);S.drawing=[];LG.drawing.clearLayers();mode('areaDraw');S.reportDraft={kind:'area',points};$('#areaDlg').classList.add('on')};
$('#areaFlooded').onclick=()=>chooseCondition('area','flooded');$('#areaBlocked').onclick=()=>chooseCondition('area','blocked');
$('#areaCancel').onclick=()=>{$('#areaDlg').classList.remove('on');S.reportDraft=null};
$('#roadFlooded').onclick=()=>chooseCondition('road','flooded');$('#roadBlocked').onclick=()=>chooseCondition('road','blocked');
$('#roadCancel').onclick=()=>{$('#roadDlg').classList.remove('on');S.reportDraft=null};
$('#reportForm').addEventListener('submit',submitReport);
$('#reportCancel').onclick=()=>{$('#reportDlg').classList.remove('on');S.reportDraft=null;$('#reportForm').reset()};
$('#bx').onclick=()=>{if(S.mode==='areaDraw'){S.drawing=[];LG.drawing.clearLayers()}mode(S.mode)};
$('#tg').onclick=()=>{const collapsed=$('#panel').classList.toggle('min');$('#tg').setAttribute('aria-expanded',String(!collapsed))};
document.addEventListener('click',event=>{if(event.target.closest('button[data-action="retry"]'))startLoad(true)});
async function updatePublicState(){
  try{installPublicState(await request('/api/public'));refresh();setStatus(`Live · ${S.cen.length} evacuation centers`)}
  catch(error){setStatus('Could not refresh reports');toast(error.message)}
}
startLoad();
setInterval(()=>{if(S.V.size)updatePublicState()},45000);
