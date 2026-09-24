export const reviewCases = [
  ['jab', .65, .14], ['cross', .72, .19], ['rake', .92, .28], ['crusher', 1.20, .39],
  ['airJab', .55, .12], ['airCross', .62, .15], ['airFinish', .72, .21],
  ['grab', 1.90, .46], ['pummelOne', 1.90, .68], ['pummelTwo', 1.90, 1.04],
  ['backThrow', 2.35, 1.74], ['recover', 3.70, 2.90],
  ['coreRip', 3.70, 1.78], ['overload', 3.70, 1.95], ['brutality', 3.70, 1.32],
  ['wreck', 5.40, 3.45], ['lights', 3, 1.20],
].map(([name,duration,contact])=>({name,duration,contact}));

export function sampleReview(name, t, facing = 1) {
  const a = { id:'a',skin:'amber',x:-1.05*facing,y:0,facing,hp:100,action:'idle',actionTime:t };
  const b = { id:'b',skin:'cyan',x:1.05*facing,y:0,facing:-facing,hp:55,action:'idle',actionTime:t };
  const beats={jab:[.11,.38],cross:[.16,.49],rake:[.24,.68],crusher:[.34,1.02],airJab:[.09,.30],airCross:[.12,.36],airFinish:[.17,.48]};
  if(beats[name]){
    const [startup,duration]=beats[name];
    a.action=t<=duration?(name==='crusher'?'heavy':'light'):'idle'; a.variant=t<=duration?name:'';
    a.actionDuration=duration;a.chain=['cross','airCross'].includes(name)?2:['rake','crusher','airFinish'].includes(name)?3:1;
    a.x+=facing*.16*Math.min(t/startup,1);
    if(name.startsWith('air'))a.y=b.y=Math.max(0,1.2+2.4*t-12*t*t);
    if(t>=startup&&t<startup+.32){b.action='hit';b.variant=name==='airFinish'?'launched':'';b.actionTime=t-startup;b.actionDuration=.32;}
  }else if(['grab','pummelOne','pummelTwo','backThrow'].includes(name)){
    const holding=t>=.26&&t<1.40;
    const strike=t>=.90&&t<=1.20?t-.90:t>=.54&&t<=.84?t-.54:null;
    const shared={grabHoldTime:Math.max(0,t-.26),grabStrikeTime:strike,grabStrikes:t>=.90?2:t>=.54?1:0,grabThrowTime:t>=1.20&&holding?t-1.20:null,throwStyle:name==='backThrow'?'back':'forward',grabThrowDirection:name==='backThrow'?-facing:facing};
    Object.assign(a,shared,{action:t<1.70?'heavy':'idle',variant:t<1.70?'grab':'',actionDuration:1.70,grabTarget:holding?'b':null,grabReleaseTime:t>=1.40?1.40:null});
    Object.assign(b,shared,{action:holding||t>=1.40&&t<1.88?'hit':'idle',variant:holding?'grabbed':t>=1.40&&t<1.88?'thrown':'',grabbedBy:holding?'a':null,actionTime:holding?t-.26:Math.max(0,t-1.40),actionDuration:holding?1.25:.48});
    const thrown=Math.max(0,t-1.4);const back=name==='backThrow';
    b.x+=facing*(back?-10.5:6.5)*(back?Math.min(Math.max(0,thrown-.16),.4):Math.min(thrown,.4));b.y=Math.max(0,(back?12:3.4)*thrown-12*thrown*thrown);
  }else if(name==='recover'){
    Object.assign(a,{action:t<2?'ko':'recover',hp:t<2?0:100,actionTime:t<2?t:t-2,actionDuration:t<2?2:1.6});
    b.action='victory';
  }else if(name==='lights'){
    a.hp=18;b.hp=100;
  }else{
    const variant=name==='wreck'?'overload':name;
    Object.assign(a,{action:t<2.15?'finisher':'victory',variant,actionTime:t<2.15?t:t-2.15,actionDuration:3.7});
    Object.assign(b,{action:t<2.15?'defeated':'destroyed',variant,hp:0,actionTime:t<2.15?t:t-2.15,actionDuration:3.7,destructionTime:Math.max(0,t-2.15)});
  }
  a.grabPartnerX=b.x;a.grabPartnerY=b.y;b.grabPartnerX=a.x;b.grabPartnerY=a.y;
  return [a,b];
}
