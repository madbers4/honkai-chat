import { assetUrl as defaultAssetUrl } from './app-paths.js';
import { GENERATED_VOICE_CLIPS } from '../shared/generated-voice-clips.js';
import { VOICE_START_GRACE, SPOKEN_CLIP_IDS } from '../shared/spoken-catalog.js';
import { preparationDeadline } from './preparation-deadline.js';
const allowedIds = new Set(SPOKEN_CLIP_IDS);

/** Only the two recorded actors. Device speech and legacy dialogue are never
 * playback fallbacks, including after failed downloads or old preferences. */
export function createStoryVoice({ assetUrl = defaultAssetUrl, onStatus = () => {},
  makeContext = () => { const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; return Ctx ? new Ctx() : null; },
  fetcher = globalThis.fetch?.bind(globalThis), visibility = globalThis.document,
  loadTimeoutMs = 10000, clipCatalog = GENERATED_VOICE_CLIPS, concurrency = 3, retryAfterMs = 5000, now = Date.now } = {}) {
  let ctx=null, master=null, unlocked=false, muted=false, disposed=false, active=null, pausedRecord=null, sequence=null;
  let statusKey='', fault='', inFlight=0, decodingCount=0, warmIds=[], unavailable=false;
  const lifetime = new AbortController(), decodeQueue = [];
  const cache=new Map(), seen=new Set(), queue=[], limit=Math.max(1,Math.min(4,Math.floor(Number(concurrency)||3)));
  const permitted=id=>allowedIds.has(id)&&['p1','p2'].includes(clipCatalog[id]?.speaker)
    && /^\/assets\/voices\/[^?#]+\.mp3$/.test(clipCatalog[id]?.url||'')&&!clipCatalog[id].url.includes('..');
  const counters={started:0,lastClip:null};
  function capabilities() {
    const loading=inFlight+queue.length,failed=warmIds.map(id=>cache.get(id)).find(entry=>entry?.failed);
    const problem=failed?.error||fault||(unavailable?'Записи этой сцены недоступны. Имена и реплики — в субтитрах.':'');
    return {unlocked,muted,loading,...counters,retryAvailable:Boolean(failed),
      message:muted?'Звук выключен':problem||(!unlocked?'Нажми «Включить звук» перед сценой':
        loading?'Загружаем реплики актёров… Имена — в субтитрах.':'Два записанных актёра · имена в субтитрах'),
      mode:muted?'muted':problem?'subtitles':'recordings'};
  }
  function report(){const value=capabilities(),key=JSON.stringify(value);if(key!==statusKey&&!disposed){statusKey=key;onStatus(value);}}
  function stopActive(){const old=active;active=null;if(old){old.source.onended=null;try{old.source.stop();}catch{}try{old.source.disconnect();}catch{}}}
  function cancel(){stopActive();pausedRecord=null;}
  function pump(){
    while(!disposed&&inFlight<limit&&queue.length){
      const {entry,id,resolve}=queue.shift();inFlight++;
      void download(entry,id).finally(()=>{inFlight--;entry.pending=null;resolve();pump();report();});
    }
    report();
  }
  async function download(entry,id){
    for(let attempt=0;attempt<2&&!disposed;attempt++){
      const controller=new AbortController();let timer;
      try{
        const deadline=new Promise((_,reject)=>{entry.abort=()=>{controller.abort();reject(new Error('Recording download cancelled'));};timer=setTimeout(entry.abort,loadTimeoutMs);});
        const request=(async()=>{
          if(!fetcher)throw new Error('Audio transport unavailable');
          const response=await fetcher(assetUrl(clipCatalog[id].url),{signal:controller.signal,cache:attempt?'reload':'no-cache'});
          if(!response.ok)throw new Error('Recording unavailable');return response.arrayBuffer();
        })();
        const bytes=await Promise.race([request,deadline]);
        if(!disposed){entry.bytes=bytes;entry.failed=false;entry.error='';}return;
      }catch{
        if(attempt===1&&!disposed){entry.failed=true;entry.failedAt=now();entry.error='Запись не загрузилась. Пока — субтитры; можно повторить загрузку.';}
      }finally{clearTimeout(timer);entry.abort=null;}
    }
  }
  async function load(id,retryFailed=false){
    if(!permitted(id)||disposed)return null;
    let entry=cache.get(id);
    if(!entry){entry={bytes:null,buffer:null,pending:null,failed:false,failedAt:0};cache.set(id,entry);}
    if(entry.failed&&!retryFailed&&now()-entry.failedAt<retryAfterMs)return null;
    if(!entry.buffer&&!entry.bytes&&!entry.pending){
      entry.failed=false;entry.pending=new Promise(resolve=>queue.push({entry,id,resolve}));pump();
    }
    await entry.pending;
    if(disposed||entry.failed||!ctx)return null;
    if(!entry.buffer&&entry.bytes){
      if (!entry.decoding) {
        entry.decoding = new Promise(resolve => decodeQueue.push({entry,resolve}));
        pumpDecoders();
      }
      await entry.decoding;
    }
    return disposed?null:entry.buffer;
  }
  function pumpDecoders() {
    while (!disposed && decodingCount < limit && decodeQueue.length) {
      const {entry,resolve} = decodeQueue.shift(); decodingCount++;
      // Assign buffers only after the deadline race. A timed-out native decoder
      // may finish later, but must never overwrite a successful explicit retry.
      void preparationDeadline(() => ctx.decodeAudioData(entry.bytes.slice(0)), {
        timeoutMs:loadTimeoutMs, signal:lifetime.signal,
      }).then(buffer => {
        if (!disposed) {
          if (!Number.isFinite(buffer?.duration) || buffer.duration <= .03) throw Error('Empty recording');
          entry.buffer = buffer; entry.bytes = null; entry.failed = false; entry.error = '';
        }
      }).catch(() => {
        entry.bytes=null;entry.failed=true;entry.failedAt=now();
        entry.error='Запись не прочиталась. Пока — субтитры; можно повторить загрузку.';
      }).finally(() => {
        decodingCount--; entry.decoding=null; resolve(); pumpDecoders(); report();
      });
    }
  }
  function preload(beats=[],{retryFailed=false}={}){
    unavailable=beats.some(beat=>beat.audioUnavailable);
    warmIds=[...new Set(beats.map(beat=>beat.clip).filter(permitted))];
    report();
    return Promise.all(warmIds.map(id=>load(id,retryFailed)));
  }
  async function unlock(){
    if(disposed)return false;
    try{
      ctx??=makeContext();if(!ctx){fault='Этот браузер не воспроизводит записи. Субтитры остаются.';report();return false;}
      if(!master){master=ctx.createGain();master.gain.value=muted?0:.62;master.connect(ctx.destination);}
      await preparationDeadline(() => ctx.resume(), {timeoutMs:loadTimeoutMs,signal:lifetime.signal});
      if (disposed) return false;
      unlocked=ctx.state==='running';if(unlocked){fault='';void Promise.all(warmIds.map(id=>load(id)));}
      report();return unlocked;
    }catch{fault='Браузер ждёт нажатия для звука. Нажми «Включить звук».';report();return false;}
  }
  let preparation;
  function prepareAll({onProgress = () => {}} = {}) {
    if (preparation) return preparation;
    preparation = (async () => {
      if (!await unlock()) throw new Error('Нажми «Проверить звук», чтобы включить озвучку.');
      const ids = [...allowedIds].filter(permitted);
      if (ids.length !== allowedIds.size) throw new Error('Набор реплик неполный. Обнови страницу.');
      let cursor = 0, completed = 0;
      onProgress({kind:'voices', loaded:0, total:ids.length});
      // Limit decoding as well as network requests. A catalogue-sized burst of
      // decodeAudioData jobs can itself cause the first-fight hitch on phones.
      const jobs = await Promise.allSettled(Array.from({length:limit}, async () => {
        while (cursor < ids.length && !disposed) {
          const id = ids[cursor++];
          const buffer = await load(id, true);
          if (!buffer) throw new Error('Не все реплики загрузились. Нажми «Повторить подготовку».');
          onProgress({kind:'voices', loaded:++completed, total:ids.length});
        }
      }));
      const failure = jobs.find(job => job.status === 'rejected');
      if (failure) throw failure.reason;
      if (disposed || completed !== ids.length) throw new Error('Подготовка озвучки отменена.');
      if (ctx.state !== 'running') throw new Error('Нажми «Проверить звук», чтобы продолжить.');
      return {loaded:completed,total:ids.length};
    })().finally(() => { preparation = null; });
    return preparation;
  }
  function playClip(beat,elapsed,resumedAt=null){
    if(!permitted(beat.clip))return true;
    const buffer=cache.get(beat.clip)?.buffer;if(!buffer){void load(beat.clip);return false;}
    const startedAt=resumedAt??elapsed,age=Math.max(0,elapsed-startedAt),offset=Math.max(0,beat.clipOffset||0)+age;
    const remaining=Math.min(buffer.duration-offset,(beat.clipDuration??beat.duration)-age);
    if(remaining<=.02)return true;if(active)return false;
    try{
      const source=ctx.createBufferSource();source.buffer=buffer;source.connect(master);
      const record={beat,source,sequence,startedAt,endsAt:elapsed+remaining};active=record;
      source.onended=()=>{if(active===record)active=null;try{source.disconnect();}catch{}};
      source.start(0,offset,remaining);counters.started++;counters.lastClip=beat.clip;report();return true;
    }catch{fault='Звук записи недоступен. Субтитры остаются.';active=null;report();return true;}
  }
  function update(next={}){
    if(disposed)return;
    const elapsed=Math.max(0,Number(next.elapsed)||0),beats=Array.isArray(next.beats)?next.beats:[];
    if(sequence!==next.sequenceId){cancel();seen.clear();sequence=next.sequenceId;void preload(beats);}
    if(seen.size>512){const keep=[...seen].slice(-256);seen.clear();keep.forEach(id=>seen.add(id));}
    if(next.enabled===false||muted||visibility?.hidden||!unlocked){cancel();for(const beat of beats)if(elapsed>=beat.at)seen.add(beat.id);return;}
    if(next.paused){if(active){pausedRecord={beat:active.beat,sequence,startedAt:active.startedAt,endsAt:active.endsAt};stopActive();}return;}
    if(pausedRecord){const old=pausedRecord;pausedRecord=null;if(old.sequence===sequence&&elapsed<old.endsAt)playClip(old.beat,elapsed,old.startedAt);}
    if(active&&(active.sequence!==sequence||elapsed>=active.endsAt))stopActive();
    for(const beat of beats){
      if(seen.has(beat.id)||elapsed<beat.at)continue;
      if(elapsed-beat.at>VOICE_START_GRACE+1e-8||elapsed>=beat.at+(beat.clip?beat.clipDuration??beat.duration:beat.duration)){seen.add(beat.id);continue;}
      if(!beat.clip||playClip(beat,elapsed))seen.add(beat.id);
    }
  }
  const onHidden=()=>{if(visibility?.hidden)cancel();};visibility?.addEventListener?.('visibilitychange',onHidden);
  return {unlock,preload,prepareAll,update,cancel,getCapabilities:capabilities,
    retry(){return preload(warmIds.map(clip=>({clip})),{retryFailed:true});},
    setMuted(value){muted=Boolean(value);if(master)master.gain.value=muted?0:.62;if(muted)cancel();report();},
    dispose(){
      if(disposed)return;cancel();disposed=true;lifetime.abort();visibility?.removeEventListener?.('visibilitychange',onHidden);
      for(const entry of cache.values())entry.abort?.();for(const job of queue.splice(0)){job.entry.pending=null;job.resolve();}
      for(const job of decodeQueue.splice(0)){job.entry.decoding=null;job.resolve();}
      cache.clear();seen.clear();try{master?.disconnect();void ctx?.close();}catch{}
    },
  };
}
