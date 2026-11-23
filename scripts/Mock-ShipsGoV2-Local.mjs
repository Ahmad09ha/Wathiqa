// Contract test double for ShipsGo V2. Only binds the loopback interface.
// No real ShipsGo credentials or requests. Run with the C# contract harness.
import http from "node:http";
const port=Number(process.env.SHIPSGO_V2_MOCK_PORT || 5098);
let posts=0;
const registered=new Set();
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");
  const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(url.pathname==="/__qa_stats")return reply(200,{posts});
  if(req.headers["x-shipsgo-user-token"]!=="qa-v2-only" ||
      !req.headers.accept?.includes("application/json"))
    return reply(401,{message:"UNAUTHORIZED"});
  if(req.method==="GET" && url.pathname==="/ocean/carriers")
    return reply(200,{message:"SUCCESS",carriers:[
      {scac:"MSCU",name:"MSC",status:"ACTIVE"},
      {scac:"SG_AKKN",name:"AKKON LINES",status:"ACTIVE"},
      {scac:"NSAU",name:"BAHRI",status:"PASSIVE"}],meta:{more:false,total:3}});
  if(req.method==="GET" && url.pathname==="/ocean/shipments") {
    const filter=url.searchParams.get("filters[reference]")||"";
    const reference=filter.startsWith("eq:")?filter.slice(3):"";
    const found=[...registered].filter(k=>k.startsWith(reference+"|")&&reference.length>0);
    return reply(200,{message:"SUCCESS",shipments:found.map(k=>({
      id:123456,reference,booking_number:k.endsWith("|MEDUQY000000")?
        "MEDUQY000000":null,container_number:k.endsWith("|MSCU1234567")?
        "MSCU1234567":null
    })),meta:{more:false,total:found.length}});
  }
  if(req.method==="POST" && url.pathname==="/ocean/shipments"){
    let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>8000)return reply(413,{message:"TOO_LARGE"});}
    let body;try{body=JSON.parse(raw)}catch{return reply(400,{message:"INVALID_BODY"});}
    if(!body.reference?.startsWith("WATHIQA-") ||
       !["MSCU","SG_AKKN",null].includes(body.carrier) ||
       !(body.booking_number||body.container_number))
      return reply(400,{message:"BAD_REFERENCE"});
    const key=body.reference+"|"+(body.booking_number||body.container_number);
    if(registered.has(key))
      return reply(409,{message:"ALREADY_EXISTS",shipment:{id:123456,
        reference:body.reference,booking_number:body.booking_number,
        container_number:body.container_number}});
    registered.add(key);
    posts++;
    return reply(200,{message:"SUCCESS",shipment:{id:123456,reference:body.reference,
      booking_number:body.booking_number,container_number:body.container_number}});
  }
  if(req.method==="GET" && url.pathname==="/ocean/shipments/123456")
    return reply(200,{message:"SUCCESS",shipment:{
      id:123456,status:"SAILING",carrier:{scac:"MSCU",name:"MSC"},
      booking_number:"MEDUQY000000",container_number:"MSCU1234567",container_count:1,
      route:{port_of_loading:{location:{code:"CNSHA",name:"SHANGHAI"},
        date_of_loading:"2026-11-01T12:00:00+08:00"},
        port_of_discharge:{location:{code:"TRISK",name:"ISKENDERUN"},
        date_of_discharge:"2026-12-15T12:00:00+03:00"},
        transit_percentage:30,ts_count:0},
      containers:[{number:"MSCU1234567",status:"SAILING",size:40,type:"HC",
        movements:[{event:"DEPA",status:"ACT",location:{name:"SHANGHAI"},
          vessel:{name:"TEST VESSEL"},voyage:"A1",timestamp:"2026-11-03T12:00:00+08:00"}]}],
      updated_at:"2026-11-03 12:00:00",
      tokens:{map:"00000000-0000-0000-0000-000000000001"}
    }});
  if(req.method==="GET" && url.pathname==="/ocean/shipments/123456/geojson")
    return reply(200,{message:"SUCCESS",geojson:{type:"FeatureCollection",features:[
      {type:"Feature",geometry:{type:"Point",coordinates:[36.4,35.9]},
       properties:{status:"CURRENT"}},
      {type:"Feature",geometry:{type:"LineString",
        coordinates:[[35.5,35.6],[36.4,35.9],[37.1,36.1]]},
        properties:{status:"PAST"}},
      {type:"Feature",geometry:{type:"Point",coordinates:[37.1,36.1]},
        properties:{status:"FUTURE",location:{name:"ISKENDERUN"}}}
    ]}});
  reply(404,{message:"NOT_FOUND"});
});
server.listen(port,"127.0.0.1",()=>console.log("SHIPSGO_V2_MOCK_READY="+port));
