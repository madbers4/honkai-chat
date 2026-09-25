import { activeFaceoffBeat, FACE_OFF_DURATION, FACE_OFF_CHAPTERS } from '../shared/faceoff-script.js';
import { computeFaceoffCamera, faceoffShotState } from './faceoff-camera.js';
import { projectCameraPoint } from './camera-choreography.js';

const text = (element, value) => { const string=String(value??''); if(element.textContent!==string)element.textContent=string; };
export function createFaceoffUI(container) {
  const doc=container.ownerDocument||document;
  const make=(tag,className,value='')=>{const element=doc.createElement(tag);element.className=className;element.textContent=value;return element;};
  const root=make('section','faceoff-scene');root.hidden=true;root.setAttribute('aria-label','Кинематографическое противостояние автоматонов');
  const matte=make('div','faceoff-film-matte'),lines=make('div','faceoff-speedlines');matte.setAttribute('aria-hidden','true');lines.setAttribute('aria-hidden','true');
  const eyebrow=make('div','faceoff-eyebrow','ФОНТЕЙНКА ПРЕДСТАВЛЯЕТ / НОВЫЙ БОЙЦОВСКОЙ КЛУБ');
  const heading=make('div','faceoff-heading');
  const names=make('div','faceoff-names');
  const cards=[0,1].map(index=>{
    const card=make('div',`faceoff-card faceoff-card-${index}`),role=make('span','faceoff-role',index?'02 / ПРЕТЕНДЕНТ':'01 / ПРЕТЕНДЕНТ');
    const name=make('strong','faceoff-real-name'),status=make('span','faceoff-identity-state');
    card.append(role,name,status);names.append(card);return{card,name,status};
  });
  const mechanism=make('div','faceoff-mechanism');
  const caption=make('div','faceoff-caption'),speaker=make('span','faceoff-speaker'),line=make('p','faceoff-line');
  caption.setAttribute('role','status');caption.setAttribute('aria-live','polite');caption.append(speaker,line);
  const bottom=make('div','faceoff-bottom'),progress=make('div','faceoff-progress'),fill=make('i','faceoff-progress-fill');
  progress.append(fill);const countdown=make('span','faceoff-countdown'),voice=make('span','faceoff-voice-note');
  bottom.append(progress,countdown,voice);root.append(matte,lines,eyebrow,heading,names,mechanism,caption,bottom);container.append(root);
  let disposed=false,lastBeat=null;
  function update({active=false,sequenceId,elapsed=0,paused=false,players=[],beats=[],voiceStatus={},reducedMotion=false}={}) {
    if(disposed)return;
    root.hidden=!active;if(!active){lastBeat=null;return;}
    const t=Math.max(0,Number(elapsed)||0),beat=activeFaceoffBeat(beats,t);
    const shot=faceoffShotState({story:{elapsed:t},players,beats,reduced:reducedMotion});
    root.dataset.chapter=shot.chapter;root.dataset.shot=shot.shot;root.dataset.paused=String(paused);root.dataset.reduced=String(reducedMotion);
    root.dataset.revealed='true';root.dataset.glitch='false';
    const rect=root.getBoundingClientRect?.(),width=rect?.width||globalThis.innerWidth||1280,height=rect?.height||globalThis.innerHeight||720;
    const aspect=width/height,camera=computeFaceoffCamera({story:{elapsed:t},players,beats,reduced:reducedMotion,aspect});
    for(const[index,card]of cards.entries()) {
      const player=players[index],point=projectCameraPoint({x:player?.x??(index?1.85:-1.85),y:(player?.y??0)+2.9,z:0},camera,aspect);
      text(card.name,player?.name||`Автоматон ${index+1}`);
      card.card.classList.toggle('speaking',beat?.speaker===player?.id);
      const isPrimary=!shot.primary||shot.primary===player?.id;
      card.card.hidden=(!isPrimary&&!shot.transition)||Math.abs(point.x)>1.13;
      card.card.style.left=`${Math.max(16,Math.min(84,(point.x*.5+.5)*100))}%`;
      card.card.style.top=`${Math.max(height<500?55:73,Math.min(height*.29,(.5-point.y*.5)*height-45))}px`;
      text(card.status,shot.chapter==='dialogue'?`ПАКЕТ ПАФОСА / ${index?'ДИО':'ДЖОТАРО'}`:shot.chapter==='mode'?'БОЕВОЙ КОНТУР ВКЛЮЧЁН':'ИМЯ В ПАСПОРТЕ / НАСТОЯЩЕЕ');
    }
    text(heading,paused?'СЦЕНА НА ПАУЗЕ':FACE_OFF_CHAPTERS[shot.chapter]);
    text(mechanism,shot.detail?`${shot.detail==='core'?'01 / РЕАКТОР':'02 / ПРИВОДЫ'}\n${beat?.system||''}`:'');
    mechanism.hidden=!shot.detail||reducedMotion;
    const identity=players.find(player=>player.id===beat?.speaker);
    text(speaker,beat?.annotation?'СИСТЕМА / ПАКЕТ ПАФОСА':beat?.speaker==='narrator'?'НОВЫЙ БОЙЦОВСКОЙ КЛУБ':identity?.name||'АВТОМАТОН');
    const key=`${sequenceId}:${beat?.id??''}`;
    if(key!==lastBeat){text(line,beat?.text||'');lastBeat=key;}
    caption.dataset.speaker=beat?.speaker||'narrator';
    fill.style.transform=`scaleX(${Math.min(1,t/FACE_OFF_DURATION)})`;
    text(countdown,paused?'ЖДЁМ ВОЗВРАЩЕНИЯ СОПЕРНИКА':`${Math.ceil(Math.max(0,FACE_OFF_DURATION-t))} С ДО БОЯ`);
    text(voice,voiceStatus.message||'Оригинальные записи / настоящие имена над бойцами');
  }
  return{element:root,update,dispose(){if(disposed)return;disposed=true;root.remove();}};
}
export const mountFaceoffUI=createFaceoffUI;
