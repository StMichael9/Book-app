// The main-thread side of the built-in reader. This file, the worker and the WebAssembly are loaded only when the scan sheet opens
// on a browser without a barcode reader of its own, so none of it is in the main bundle.
export function createWasmEngine() {
  const worker = new Worker(new URL("./scanWorker.js", import.meta.url), { type: "module" });
  let next = 0;
  const waiting = new Map();
  worker.onmessage = ({ data: { id, codes } }) => { waiting.get(id)?.(codes); waiting.delete(id); };
  worker.onerror = () => { for (const done of waiting.values()) done([]); waiting.clear(); };
  return {
    // The pixels are handed to the worker, not copied.
    read: ({ data, width, height }, frame, mode) => new Promise(done => {
      next += 1; waiting.set(next, done);
      worker.postMessage({ id: next, data, width, height, frame, mode }, [data.buffer]);
    }),
    stop: () => { worker.terminate(); for (const done of waiting.values()) done([]); waiting.clear(); },
  };
}
