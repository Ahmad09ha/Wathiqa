"use client";

import {useEffect,useRef} from "react";
import type {OceanMapCoordinate,OceanMapWaypoint,OceanMapSegment} from "@/lib/trackingApi";
import {arabicMapPhase,arabicPort} from "@/lib/trackingArabic";

// OpenStreetMap tiles with Leaflet; no third-party API key and no ShipsGo
// secret in client requests. Coordinates/paths are returned by ShipsGo GeoJSON.
export default function TrackingVoyageMap({
  latitude,longitude,waypoints,segments,
}:{
  latitude:number|null|undefined;longitude:number|null|undefined;
  waypoints:OceanMapWaypoint[];segments:OceanMapSegment[];
}){
  const node=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!node.current)return;
    let cancelled=false;
    let cleanup:undefined|(()=>void);
    void import("leaflet").then(L=>{
      if(cancelled||!node.current)return;
      const map=L.map(node.current,{zoomControl:true,scrollWheelZoom:false,
        // Place mandatory OSM credit directly BELOW the map, instead of
        // Leaflet's attribution links covering the voyage drawing.
        attributionControl:false}).setView([25,32],3);
      cleanup=()=>map.remove();
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
        maxZoom:17,
        attribution:"&copy; OpenStreetMap contributors",
      }).addTo(map);
      const layers:L.Layer[]=[];
      const isValid=(c:OceanMapCoordinate)=>Number.isFinite(c.latitude)&&
        Number.isFinite(c.longitude)&&Math.abs(c.latitude)<=90&&Math.abs(c.longitude)<=180;
      for(const segment of segments){
        const points=segment.points.filter(isValid);
        if(points.length<2)continue;
        const line=L.polyline(points.map(p=>[p.latitude,p.longitude] as [number,number]),{
          color:segment.status==="PAST"?"#0b7188":segment.status==="CURRENT"?"#007f94":"#93a5af",
          weight:4,opacity:0.85,dashArray:segment.status==="FUTURE"?"8 9":undefined,
        }).addTo(map);
        line.bindTooltip(arabicMapPhase(segment.status));
        layers.push(line);
      }
      for(const waypoint of waypoints){
        if(!isValid(waypoint))continue;
        const marker=L.circleMarker([waypoint.latitude,waypoint.longitude],{
          radius:5,weight:2,color:waypoint.status==="PAST"?"#0b7188":
            waypoint.status==="CURRENT"?"#005b67":"#84919b",
          fillColor:"#fff",fillOpacity:1,
        }).addTo(map);
        const content=document.createElement("span");
        content.textContent=arabicPort(waypoint.name)+" — "+arabicMapPhase(waypoint.status);
        marker.bindTooltip(content);
        layers.push(marker);
      }
      if(typeof latitude==="number"&&typeof longitude==="number"&&
        isValid({latitude,longitude})){
        const here=L.circleMarker([latitude,longitude],{
          radius:10,weight:3,color:"#07596a",fillColor:"#12a8c3",fillOpacity:0.85,
        }).addTo(map);
        here.bindTooltip("الموقع الذي أرسله مزوّد التتبع");
        layers.push(here);
      }
      if(layers.length>0){
        const bounds=L.featureGroup(layers).getBounds();
        if(bounds.isValid())
          map.fitBounds(bounds.pad(.15),{maxZoom:8,padding:[25,25]});
      }
      // The map is created inside a dynamically revealed tracking panel.
      requestAnimationFrame(()=>{if(!cancelled)map.invalidateSize();});
    }).catch(()=>{/* Map tiles are an enhancement; the voyage data remains visible. */});
    return()=>{cancelled=true;cleanup?.();};
  },[latitude,longitude,waypoints,segments]);
  return <>
    <div className="im-voyage-map" ref={node} role="img"
      aria-label="خريطة خط سير الشحنة وموانئ التوقف والموقع المرسل من ShipsGo"/>
    <div className="im-voyage-map-credit" aria-label="مصدر بيانات الخريطة">
      <span>بيانات الخريطة: © </span>
      <a href="https://www.openstreetmap.org/copyright" target="_blank"
        rel="noopener noreferrer">OpenStreetMap contributors</a>
      <span> · </span>
      <a href="https://www.openstreetmap.org/fixthemap" target="_blank"
        rel="noopener noreferrer">الإبلاغ عن خطأ بالخريطة</a>
    </div>
    <div className="im-voyage-map-legend">
      <span><i className="im-map-legend-dot im-map-past"/> مسار تم اجتيازه</span>
      <span><i className="im-map-legend-dot im-map-current"/> المسار أو الموقع الحالي</span>
      <span><i className="im-map-legend-dot im-map-future"/> المسار المتوقع</span>
    </div>
  </>;
}
