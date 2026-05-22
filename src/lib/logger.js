export function safeErr(err) {
  return err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err);
}

function write(level, event, meta = {}) {
  const row = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta
  };

  const line = JSON.stringify(row);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event, meta = {}) => write("info", event, meta),
  warn: (event, meta = {}) => write("warn", event, meta),
  error: (event, meta = {}) => write("error", event, meta)
};
