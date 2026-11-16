'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const map=L.map('map',{preferCanvas:true,zoomControl:false}).setView([14.8485,120.2918],15);
L.control.zoom({position:'topright'}).addTo(map);
const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abc',attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
let fallback=false;
tiles.on('tileerror',()=>{if(fallback)return;fallback=true;map.removeLayer(tiles);L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd',attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(map)});
L.rectangle([[14.838,120.277],[14.862,120.307]],{color:'#0f766e',weight:2,fill:false,dashArray:'7 6',interactive:false}).addTo(map);
const reportsLayer=L.layerGroup().addTo(map),centersLayer=L.layerGroup().addTo(map);
let pendingLocation=null,addingCenter=false,reports=[],centers=[];

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('on'),3500)}
async function request(url,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const result=await response.json().catch(()=>({error:'The server returned an invalid response.'}));
    if(!response.ok){const error=new Error(result.error||`Request failed (${response.status}).`);error.status=response.status;throw error}
    return result;
  }catch(error){
    if(error.name==='AbortError')throw new Error('The request timed out. Check your connection and try again.');
    throw error;
  }finally{clearTimeout(timer)}
}
function setAuthenticated(value){$('#loginView').hidden=value;$('#dashboard').hidden=!value}
function fmtTime(value){return new Date(value).toLocaleString()}
function renderReports(){
  reportsLayer.clearLayers();
  reports.forEach(report=>{
    const color=report.condition==='blocked'?'#dc2626':'#2563eb';
    const marker=L.circleMarker([report.lat,report.lon],{radius:8,color:'#fff',weight:2,fillColor:report.state==='active'?color:'#d97706',fillOpacity:1}).addTo(reportsLayer);
    if(report.kind==='area'&&report.points.length>=3)L.polygon(report.points,{color,weight:2,fillColor:color,fillOpacity:.18}).addTo(reportsLayer);
    marker.bindPopup(`<b>${report.kind==='area'?'Area':'Road'} · ${esc(report.condition)}</b><br><small>${esc(report.state)} · ${esc(fmtTime(report.createdAt))}</small>`);
  });
  const waiting=reports.filter(r=>r.state==='pending').length;
  $('#pendingCount').textContent=waiting;
  $('#reportList').innerHTML=reports.length?reports.map(r=>`<article class="admin-card">
    <div class="admin-card-title"><b>${r.kind==='area'?'Flooded area':'Road report'}</b><span class="admin-status ${esc(r.state)}">${esc(r.state)}</span></div>
    <div class="admin-card-meta"><span class="condition-dot ${esc(r.condition)}"></span>${esc(r.condition)} · ${fmtTime(r.createdAt)}</div>
    <div class="report-contact"><b>${esc(r.name||'Anonymous reporter')}</b>${r.phone?`<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`:''}</div>
    <div class="report-location">${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}</div>
    <div class="admin-actions">${r.state==='pending'?`<button class="b sm p" data-report="${esc(r.id)}" data-action="approve">Approve</button><button class="b sm" data-report="${esc(r.id)}" data-action="reject">Reject</button>`:''}${r.state==='active'?`<button class="b sm" data-report="${esc(r.id)}" data-action="resolve">Mark resolved</button>`:''}${['resolved','rejected'].includes(r.state)?`<button class="b sm blocked" data-report="${esc(r.id)}" data-action="delete">Delete report</button>`:''}<button class="b sm" data-view="${esc(r.id)}">View map</button></div>
  </article>`).join(''):'<div class="empty"><b>No reports yet</b><span>Community submissions will appear here for review.</span></div>';
}
function renderCenters(){
  centersLayer.clearLayers();
  centers.forEach(c=>L.marker([c.lat,c.lon],{icon:L.divIcon({className:'',html:'<div class="cm"><span>E</span></div>',iconSize:[34,34],iconAnchor:[17,31]})}).bindTooltip(esc(c.name)).addTo(centersLayer));
  $('#centerList').innerHTML=centers.length?centers.map(c=>`<article class="admin-card center-card"><div><b>${esc(c.name)}</b><small>${Number(c.lat).toFixed(5)}, ${Number(c.lon).toFixed(5)}</small></div><button class="b sm blocked" data-center="${esc(c.id)}">Remove</button></article>`).join(''):'<div class="empty"><b>No evacuation centers registered</b><span>Add and verify centers so users can find the nearest location.</span></div>';
}
async function refresh(){
  try{
    const [admin,publicState]=await Promise.all([request('/api/admin/reports'),request('/api/public')]);
    reports=admin.reports;centers=publicState.centers;
    renderReports();renderCenters();setAuthenticated(true);
  }catch(error){if(error.status===401){reports=[];centers=[];reportsLayer.clearLayers();centersLayer.clearLayers();setAuthenticated(false)}toast(error.message)}
}
$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();$('#loginError').textContent='';
  try{await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});$('#password').value='';setAuthenticated(true);await refresh()}
  catch(error){$('#loginError').textContent=error.message}
});
$('#logout').onclick=async()=>{try{await request('/api/admin/logout',{method:'POST',body:'{}'});reports=[];centers=[];reportsLayer.clearLayers();centersLayer.clearLayers();renderReports();renderCenters();setAuthenticated(false)}catch(error){toast(error.message)}};
$('#refresh').onclick=refresh;
$('#reportList').addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  const report=reports.find(r=>r.id===button.dataset.report||r.id===button.dataset.view);
  if(button.dataset.view&&report){map.flyTo([report.lat,report.lon],17);return}
  if(!button.dataset.action||!report)return;
  const action=button.dataset.action;
  try{
    await request(`/api/admin/reports/${encodeURIComponent(report.id)}`,action==='delete'?{method:'DELETE'}:{method:'PATCH',body:JSON.stringify({action})});
    await refresh();toast(action==='delete'?'Report deleted.':`Report ${({approve:'approved',reject:'rejected',resolve:'resolved'})[action]}.`);
  }
  catch(error){toast(error.message)}
});
$('#addCenter').onclick=()=>{addingCenter=true;$('#mapHint').hidden=false;map.getContainer().classList.add('pick')};
$('#cancelCenter').onclick=()=>{addingCenter=false;$('#mapHint').hidden=true;map.getContainer().classList.remove('pick')};
map.on('click',event=>{
  if(!addingCenter)return;
  pendingLocation=event.latlng;addingCenter=false;$('#mapHint').hidden=true;map.getContainer().classList.remove('pick');
  $('#centerName').value='';$('#centerDlg').classList.add('on');$('#centerName').focus();
});
function closeCenter(){pendingLocation=null;$('#centerDlg').classList.remove('on')}
$('#cancelSave').onclick=closeCenter;
$('#centerForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!pendingLocation)return;
  const button=$('#centerForm button[type="submit"]');button.disabled=true;
  try{
    await request('/api/admin/centers',{method:'POST',body:JSON.stringify({name:$('#centerName').value.trim(),lat:pendingLocation.lat,lon:pendingLocation.lng})});
    closeCenter();await refresh();toast('Evacuation center added.');
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
});
$('#centerList').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-center]');
  if(!button)return;
  if(!confirm('Remove this evacuation center from the public map?'))return;
  try{await request(`/api/admin/centers/${encodeURIComponent(button.dataset.center)}`,{method:'DELETE'});await refresh();toast('Evacuation center removed.')}
  catch(error){toast(error.message)}
});
async function init(){
  try{const session=await request('/api/admin/session');setAuthenticated(session.authenticated);if(session.authenticated)await refresh()}
  catch(error){$('#loginError').textContent='Admin service is unavailable. Check that the SAFEPATH server is running.'}
}
init();
