// The reader's own calendar day (YYYY-MM-DD), never the server's or UTC's.
export function localToday(now = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
