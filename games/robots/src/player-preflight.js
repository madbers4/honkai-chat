/** A room-scoped commitment: a cached passport is a starting point, never a
 * substitute for confirming appearance and checking this phone's sound. */
export function createPlayerPreflight({ prepare, commit, changed = () => {} }) {
  let step = 'passport', passport = false, appearance = false, heard = false;
  let busy = false, committed = false, error = '', progress = '', generation = 0;
  const snapshot = () => ({ step, passport, appearance, heard, busy, committed, error, progress });
  const notify = () => changed(snapshot());
  const invalidate = () => { generation++; busy = false; committed = false; error = ''; progress = ''; };
  return {
    snapshot,
    reset() { invalidate(); step = 'passport'; passport = appearance = heard = false; notify(); },
    edit(value) {
      if (busy || committed) return false;
      if (value === 'sound' && !appearance || value === 'appearance' && !passport) return false;
      step = value;
      if (value === 'passport') passport = appearance = heard = false;
      if (value === 'appearance') appearance = heard = false;
      error = ''; notify(); return true;
    },
    savePassport(name) {
      if (busy || committed) return false;
      if (!String(name || '').trim()) { error = 'Назови робота, чтобы рефери мог представить его.'; notify(); return false; }
      passport = true; appearance = heard = false; step = 'appearance'; error = ''; notify(); return true;
    },
    saveAppearance() {
      if (busy || committed || !passport || step !== 'appearance') return false;
      appearance = true; heard = false; step = 'sound'; error = ''; notify(); return true;
    },
    soundChecked() { if (step !== 'sound' || busy || committed) return; heard = true; error = ''; notify(); },
    soundMuted() { heard = false; if (busy) invalidate(); notify(); },
    cancel() { invalidate(); notify(); },
    async confirm() {
      if (busy || committed || !passport || !appearance || !heard || step !== 'sound') return false;
      const attempt = ++generation;
      busy = true; error = ''; progress = 'Загружаем озвучку и готовим эффекты…'; notify();
      try {
        await prepare(value => { if (generation === attempt && busy) { progress = String(value?.message ?? value ?? ''); notify(); } });
        if (generation !== attempt) return false;
        // The caller also verifies that the room, connection and stage still
        // match. A completed old download may not ready a newly joined room.
        if (commit() === false) throw Error('connection');
        committed = true; busy = false; progress = 'Всё готово. Ждём второго бойца.'; notify(); return true;
      } catch {
        if (generation !== attempt) return false;
        busy = false; error = 'Не всё загрузилось. Проверь соединение и повтори подготовку.'; progress = ''; notify(); return false;
      }
    },
  };
}
