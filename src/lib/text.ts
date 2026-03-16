export function isProbablyBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) {
    return false;
  }

  const sampleSize = Math.min(bytes.byteLength, 4096);
  let suspicious = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const byte = bytes[index];
    if (byte === 0) {
      return true;
    }

    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.3;
}

export function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }

  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.split("\n");
}

export function readLineRange(
  lines: string[],
  start: number,
  end: number,
): { ok: true; start: number; end: number; content: string } | { ok: false; message: string } {
  if (lines.length === 0) {
    return { ok: false, message: "Cannot read a line range from an empty file." };
  }

  if (start > lines.length) {
    return { ok: false, message: "Requested range starts after the end of the file." };
  }

  const clampedEnd = Math.min(end, lines.length);
  return {
    ok: true,
    start,
    end: clampedEnd,
    content: lines.slice(start - 1, clampedEnd).join("\n"),
  };
}
