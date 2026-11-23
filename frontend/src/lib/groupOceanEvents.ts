import type {OceanEvent} from "@/lib/trackingApi";

/** A single movement shared by one or more containers.
 *
 * ShipsGo reports one event per container. Group only when movement code,
 * instant, actual/estimated flag, port, vessel and voyage ALL agree.
 * Container numbers remain visible; distinct activities are never collapsed.
 * This is presentation-only; the original payload stays unchanged.
 */
export interface GroupedOceanEvent {
  eventCode:string;
  description:string;
  date:string;
  actual:boolean;
  location:string;
  vessel:string;
  voyage:string;
  containerNumbers:string[];
}

const normalize=(value:string|undefined|null)=>(value||"").trim().toUpperCase();
const normalizedInstant=(value:string|undefined|null)=>{
  const raw=(value||"").trim();
  // Compare the same real instant even if provider uses different offsets.
  if(/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)){
    const date=new Date(raw);
    if(!Number.isNaN(date.getTime()))return date.toISOString();
  }
  return raw;
};

export const groupOceanEvents=(events:readonly OceanEvent[]):GroupedOceanEvent[]=>{
  const groups=new Map<string,GroupedOceanEvent>();
  for(const event of events){
    const code=normalize(event.eventCode);
    const key=JSON.stringify([
      code||normalize(event.description),
      normalizedInstant(event.date),
      event.actual,
      normalize(event.location),
      normalize(event.vessel),
      normalize(event.voyage),
    ]);
    let group=groups.get(key);
    if(!group){
      group={
        eventCode:event.eventCode,
        description:event.description,
        date:event.date,
        actual:event.actual,
        location:event.location,
        vessel:event.vessel,
        voyage:event.voyage,
        containerNumbers:[],
      };
      groups.set(key,group);
    }
    const container=(event.containerNumber||"").trim();
    if(container&&!group.containerNumbers.some(x=>normalize(x)===normalize(container)))
      group.containerNumbers.push(container);
  }
  return [...groups.values()];
};
