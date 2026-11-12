// ShipsGo v1.2 local protocol fixture. Never connects to ShipsGo itself.
// Only binds 127.0.0.1 and uses a deliberately invalid QA credential.
import http from "node:http";
const port=Number(process.env.SHIPSGO_MOCK_PORT||5099);
let posts=0,gets=0;
const registrations=[];
const server=http.createServer(async (req,res)=>{
  const path=new URL(req.url,"http://127.0.0.1").pathname;
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json");
  if(req.method==="GET" && path==="/__qa_stats"){
    res.end(JSON.stringify({posts,gets,registrations}));return;
  }
  if(req.method==="POST" && path==="/api/v1.2/ContainerService/PostContainerInfoWithBl"){
    let body="";for await(const data of req){body+=data;if(body.length>8192){res.writeHead(413).end();return;}}
    const form=new URLSearchParams(body);
    if(form.get("authCode")!=="qa-shipsgo-only"||
       !form.get("blContainersRef")||!form.get("shippingLine")){
      res.writeHead(400).end(JSON.stringify({error:"invalid test request"}));return;
    }
    posts++;
    registrations.push({bl:form.get("blContainersRef"),carrier:form.get("shippingLine")});
    res.writeHead(200).end(JSON.stringify(10000+posts));
    return;
  }
  if(req.method==="GET"&&path==="/api/v1.2/ContainerService/GetContainerInfo/"){
    const url=new URL(req.url,"http://127.0.0.1");
    if(url.searchParams.get("authCode")!=="qa-shipsgo-only"){
      res.writeHead(403).end(JSON.stringify({error:"unauthorized"}));return;
    }
    if(!url.searchParams.has("requestId")||url.searchParams.get("mapPoint")!=="true"){
      res.writeHead(400).end(JSON.stringify({error:"missing fields"}));return;
    }
    gets++;
    res.writeHead(200).end(JSON.stringify({
      Status:"IN_TRANSIT",ShippingLine:"MSC",ShippingLineCode:"MSC",
      Vessel:"QA SEA VESSEL",Voyage:"QA-01",DateOfLoading:"2026-11-05",
      DateOfDischarge:"2026-12-01",
      MapPoint:{Latitude:31.12,Longitude:121.6},
      Containers:[{ContainerNumber:"CSQU3054383",Movements:[
        {Description:"Loaded",StatusCode:"LOAD",Location:"Ningbo",Date:"2026-11-05",IsActual:true}
      ]}]
    }));return;
  }
  res.writeHead(404).end(JSON.stringify({error:"mock endpoint not found"}));
});
server.listen(port,"127.0.0.1",()=>console.log("QA_SHIPSGO_MOCK_LISTENING="+port));
