// Local files only. No remote URLs, dynamic typing, full-file read or storage.
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export async function importDigest(value) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered(value))));
  return [...new Uint8Array(buffer)].map(number => number.toString(16).padStart(2, "0")).join("");
}

export function validateFile(file) {
  if (!file || file.size === 0 || file.size > 20 * 1024 * 1024 || !/\.(csv|tsv)$/i.test(file.name)) {
    throw new Error("Choose a CSV or TSV file up to 20 MiB. Excel files and archives are not supported.");
  }
}

export async function fileHeaders(file, encoding, signal) {
  validateFile(file);
  const { default: Papa } = await import("papaparse");
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Paused", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    Papa.parse(file, { preview: 1, header: false, dynamicTyping: false, encoding,
      delimitersToGuess: [",", "\t"], chunkSize: 65536, skipEmptyLines: "greedy",
      complete(result) {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) return reject(new DOMException("Paused", "AbortError"));
        const errors = result.errors.filter(error => error.code !== "UndetectableDelimiter");
        if (errors.length || !result.data.length) return reject(new Error("The file header could not be read. Check its CSV/TSV formatting."));
        resolve(result.data[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value));
      }, error: reject });
  });
}

export async function streamFile(file, { encoding = "UTF-8", signal, onHeaders, onBatch }) {
  validateFile(file);
  const { default: Papa } = await import("papaparse");
  return new Promise((resolve, reject) => {
    let header = null, batch = [], rowCount = 0, batchOrdinal = 0, parser, failed = false;
    const manifest = [];
    const stop = error => {
      if (failed) return;
      failed = true;
      signal?.removeEventListener("abort", abort);
      parser?.abort();
      reject(error);
    };
    const abort = () => stop(new DOMException("Paused", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    async function flush() {
      if (!batch.length) return;
      if (signal?.aborted) throw new DOMException("Paused", "AbortError");
      const current = batch;
      batch = [];
      const hash = await importDigest(current);
      const acknowledged = await onBatch(batchOrdinal, current);
      if (acknowledged.batch_hash !== hash) throw new Error("The upload acknowledgement did not match. Pause and reselect the same file.");
      manifest.push({ ordinal: batchOrdinal, hash, length: current.length });
      batchOrdinal += 1;
    }
    Papa.parse(file, { header: false, dynamicTyping: false, worker: false, encoding,
      delimitersToGuess: [",", "\t"], chunkSize: 65536, skipEmptyLines: "greedy",
      step(result, handle) {
        parser = handle;
        if (failed || signal?.aborted) return stop(new DOMException("Paused", "AbortError"));
        const errors = result.errors.filter(error => error.code !== "UndetectableDelimiter");
        if (errors.length) return stop(new Error("The file contains malformed CSV quoting. No library changes have been made."));
        const row = result.data;
        if (!header) {
          header = row.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
          handle.pause();
          Promise.resolve(onHeaders(header)).then(() => { if (!failed) handle.resume(); }).catch(stop);
          return;
        }
        rowCount += 1;
        if (rowCount > 20000 || row.length !== header.length || row.length > 128 || bytes(row) > 262144 ||
          row.some(cell => cell.includes("\u0000") || new TextEncoder().encode(cell).length > 65536)) {
          return stop(new Error("A row exceeds the supported limits or has the wrong number of columns. Nothing is silently truncated."));
        }
        if (row.some(cell => cell.includes("\uFFFD"))) return stop(new Error("Some text could not be decoded. Check the encoding before continuing; Bookvane will not guess or rewrite it."));
        if (batch.length === 100 || bytes({ rows: [...batch, row] }) > 480 * 1024) {
          handle.pause();
          flush().then(() => { batch.push(row); if (!failed) handle.resume(); }).catch(stop);
        } else batch.push(row);
      },
      complete() {
        if (failed) return;
        flush().then(async () => {
          signal?.removeEventListener("abort", abort);
          if (!rowCount) throw new Error("The file contains no book rows.");
          resolve({ row_count: rowCount, batch_count: batchOrdinal, manifest_hash: await importDigest(manifest) });
        }).catch(stop);
      }, error: stop });
  });
}

export function pastedRows(value) {
  if (new TextEncoder().encode(value).length > 480 * 1024) throw new Error("Paste a list under 480 KiB.");
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 1000) throw new Error("Paste between 1 and 1,000 books.");
  return lines.map(line => {
    // Server validates the checksum. Numeric-looking values are never invented
    // as titles if they were clearly submitted as an ISBN.
    if (/^(?:97[89][\d -]{10,}|[\d -]{9,}[\dXx])$/.test(line)) return ["", "", line];
    const separator = line.includes("\t") ? "\t" : line.includes(" — ") ? " — " : null;
    if (!separator) return [line, "", ""];
    const parts = line.split(separator);
    if (parts.length !== 2) throw new Error("Use one tab or one spaced em dash between a title and author. Ordinary title hyphens are left intact.");
    return [parts[0].trim(), parts[1].trim(), ""];
  });
}
