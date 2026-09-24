import { BODY_COLORS, CORE_COLORS, ACCESSORIES, normalizeCustomization } from '../shared/robot-customization.js';
import { createCustomizationPreview } from './customization-preview.js';

const icons={
  none:'<path d="M8 9h16v14H8zM12 9V6h8v3M11 16h2m6 0h2M12 23v3m8-3v3"/>',
  crown:'<path d="m5 10 6 5 5-9 5 9 6-5-3 15H8zM9 21h14"/><circle cx="16" cy="19" r="1.5"/>',
  topHat:'<path d="M10 7h12l-1 16H11zM6 23h20v3H6zM11 19h10"/>',
  colander:'<path d="M6 23a10 10 0 0 1 20 0ZM6 21H3v4h4m19-4h3v4h-4M13 14h.1M19 14h.1M10 19h.1M16 19h.1M22 19h.1"/>',
  propeller:'<path d="M16 14v12M11 26h10M15 12C1 10 4 4 13 8zm2 0c14 2 11 8 2 4z"/><circle cx="16" cy="12" r="2"/>',
  mustache:'<path d="M16 14c-3-3-5 4-9 4-3 0-3-3-2-5-5 7 2 13 11 7 9 6 16 0 11-7 1 2 1 5-2 5-4 0-6-7-9-4Z"/>',
};
let nextId=0;

export function createCustomizationUI(container,{value,onChange=()=>{},reducedMotion,quality='high'}={}) {
  let current=normalizeCustomization(value),disposed=false,enabled=true;
  const id=`robot-workshop-${++nextId}`,root=document.createElement('section');root.className='customization-workshop';root.setAttribute('aria-label','Мастерская робота');
  root.innerHTML=`<div class="customization-preview"><div class="customization-workshop-mark" aria-hidden="true"><span>МАСТЕРСКАЯ</span><b>№ 07</b></div><div class="customization-model"></div><div class="customization-turn"><button type="button" aria-label="Повернуть робота влево">↶</button><span>Поверни и рассмотри</span><button type="button" aria-label="Повернуть робота вправо">↷</button></div></div><div class="customization-controls"><header><span class="customization-eyebrow">СОБРАН В БЕЛОБОГЕ</span><h2>Твой характер. Твоя машина.</h2><p>Пусть тебя узнают ещё до первого удара.</p></header><div class="customization-groups"></div><p class="customization-flavor" aria-live="polite"></p></div>`;
  container.append(root);
  const inputs=new Map(),outputs=new Map(),groups=root.querySelector('.customization-groups');
  const catalogs={body:BODY_COLORS,core:CORE_COLORS,accessory:ACCESSORIES};
  const labels={body:'Корпус',core:'Ядро',accessory:'Трофей'};
  for(const [key,catalog]of Object.entries(catalogs)) {
    const fieldset=document.createElement('fieldset');fieldset.className=`customization-field customization-field-${key}`;
    const legend=document.createElement('legend');legend.textContent=labels[key];const selected=document.createElement('span');selected.className='customization-selected';legend.append(selected);outputs.set(key,selected);fieldset.append(legend);
    const choices=document.createElement('div');choices.className=`customization-choices customization-choices-${key}`;fieldset.append(choices);
    for(const choice of catalog) {
      const label=document.createElement('label');label.className='customization-choice';label.title=choice.name;
      const input=document.createElement('input');input.type='radio';input.name=`${id}-${key}`;input.value=choice.id;input.setAttribute('aria-label',choice.name);label.append(input);
      const tile=document.createElement('span');tile.className='customization-choice-tile';
      if(key==='accessory')tile.innerHTML=`<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[choice.id]}</svg><span>${choice.name}</span>`;
      else {tile.classList.add('customization-swatch');tile.style.setProperty('--swatch',choice.color);tile.innerHTML='<span aria-hidden="true">✓</span>';}
      label.append(tile);choices.append(label);inputs.set(`${key}/${choice.id}`,input);
      input.addEventListener('change',()=>{if(disposed||!enabled||!input.checked)return;current={...current,[key]:choice.id};sync();onChange({...current});});
    }
    groups.append(fieldset);
  }
  function sync(){
    for(const [key,catalog]of Object.entries(catalogs)){
      for(const choice of catalog)inputs.get(`${key}/${choice.id}`).checked=current[key]===choice.id;
      outputs.get(key).textContent=catalog.find(choice=>choice.id===current[key]).name;
    }
    root.querySelector('.customization-flavor').textContent=ACCESSORIES.find(choice=>choice.id===current.accessory).description;
  }
  sync();const preview=createCustomizationPreview(root.querySelector('.customization-model'),{value:()=>current,reducedMotion,quality});
  const turn=root.querySelectorAll('.customization-turn button');turn[0].addEventListener('click',()=>preview.rotate(-1));turn[1].addEventListener('click',()=>preview.rotate(1));
  const layout=new ResizeObserver(()=>{
    root.classList.toggle('is-compact',root.clientHeight<=410);
    root.classList.toggle('is-short',root.clientHeight<=325);
    root.classList.toggle('is-narrow',root.clientWidth<620);
  });layout.observe(root);
  return {
    value:()=>({...current}),
    set(value){if(disposed)return;current=normalizeCustomization(value);sync();},
    setEnabled(value){if(disposed)return;enabled=Boolean(value);for(const input of inputs.values())input.disabled=!enabled;turn.forEach(button=>button.disabled=!enabled);root.classList.toggle('is-locked',!enabled);preview.setEnabled(enabled);},
    setVisible(value){if(disposed)return;preview.setVisible(Boolean(value));},
    dispose(){if(disposed)return;disposed=true;layout.disconnect();preview.dispose();root.remove();},
  };
}
