/** A browser decoder or AudioContext can outlive its caller. Only the winner of
 * this bounded wait may publish readiness; late native completion is ignored. */
export function preparationDeadline(operation, { timeoutMs = 10000, signal,
  message = 'Подготовка не завершилась. Повтори попытку.' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new Error(message));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(onAbort, timeoutMs);
    try { Promise.resolve(operation()).then(value => finish(resolve, value), error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
}
