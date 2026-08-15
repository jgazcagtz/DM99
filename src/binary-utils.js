const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toUint8Array(value, label = 'binary value') {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`${label} must be an ArrayBuffer or typed array.`);
}

export function concatBytes(...parts) {
    const arrays = parts.flat().map((part) => toUint8Array(part));
    const length = arrays.reduce((total, part) => total + part.byteLength, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of arrays) {
        output.set(part, offset);
        offset += part.byteLength;
    }
    return output;
}

export function encodeUtf8(value) {
    if (typeof TextEncoder !== 'function') throw new Error('TextEncoder is unavailable.');
    return new TextEncoder().encode(String(value));
}

export function decodeUtf8(value, { fatal = true } = {}) {
    if (typeof TextDecoder !== 'function') throw new Error('TextDecoder is unavailable.');
    return new TextDecoder('utf-8', { fatal }).decode(toUint8Array(value));
}

export function asciiBytes(value) {
    const text = String(value);
    const output = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code > 0x7f) throw new TypeError('ASCII text cannot contain non-ASCII characters.');
        output[index] = code;
    }
    return output;
}

export function readAscii(value, offset, length) {
    const bytes = toUint8Array(value);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
        throw new RangeError('ASCII read is outside the byte array.');
    }
    let output = '';
    for (let index = offset; index < offset + length; index += 1) output += String.fromCharCode(bytes[index]);
    return output;
}

export function base64UrlEncode(value) {
    const bytes = toUint8Array(value);
    let output = '';
    for (let offset = 0; offset < bytes.length; offset += 3) {
        const first = bytes[offset];
        const second = offset + 1 < bytes.length ? bytes[offset + 1] : 0;
        const third = offset + 2 < bytes.length ? bytes[offset + 2] : 0;
        const packed = (first << 16) | (second << 8) | third;
        output += BASE64_ALPHABET[(packed >>> 18) & 63];
        output += BASE64_ALPHABET[(packed >>> 12) & 63];
        output += offset + 1 < bytes.length ? BASE64_ALPHABET[(packed >>> 6) & 63] : '=';
        output += offset + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : '=';
    }
    return output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlDecode(value, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(value)) {
        throw new TypeError('Value is not valid base64url text.');
    }
    if (value.length % 4 === 1) throw new TypeError('Value is not valid base64url text.');
    const estimatedLength = Math.floor((value.length * 3) / 4);
    if (estimatedLength > maxBytes) throw new RangeError('Decoded value exceeds the byte limit.');

    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const output = new Uint8Array(Math.floor((padded.length * 3) / 4) - (padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0));
    let outputOffset = 0;
    for (let offset = 0; offset < padded.length; offset += 4) {
        const a = BASE64_ALPHABET.indexOf(padded[offset]);
        const b = BASE64_ALPHABET.indexOf(padded[offset + 1]);
        const c = padded[offset + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(padded[offset + 2]);
        const d = padded[offset + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(padded[offset + 3]);
        if (a < 0 || b < 0 || c < 0 || d < 0) throw new TypeError('Value is not valid base64url text.');
        const packed = (a << 18) | (b << 12) | (c << 6) | d;
        if (outputOffset < output.length) output[outputOffset++] = (packed >>> 16) & 0xff;
        if (outputOffset < output.length) output[outputOffset++] = (packed >>> 8) & 0xff;
        if (outputOffset < output.length) output[outputOffset++] = packed & 0xff;
    }
    return output;
}

export function encodeVariableLengthQuantity(input) {
    if (!Number.isInteger(input) || input < 0 || input > 0x0fffffff) {
        throw new RangeError('MIDI variable-length value must be an integer from 0 to 0x0fffffff.');
    }
    const bytes = [input & 0x7f];
    let value = input >>> 7;
    while (value > 0) {
        bytes.unshift((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    return Uint8Array.from(bytes);
}

export function readVariableLengthQuantity(input, startOffset, { endOffset, maxBytes = 4 } = {}) {
    const bytes = toUint8Array(input);
    const end = endOffset ?? bytes.length;
    if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset >= end || end > bytes.length) {
        throw new RangeError('MIDI variable-length read is outside the byte array.');
    }
    let value = 0;
    let offset = startOffset;
    for (let count = 0; count < maxBytes; count += 1) {
        if (offset >= end) throw new RangeError('Truncated MIDI variable-length value.');
        const byte = bytes[offset++];
        value = (value << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) return { value, offset };
    }
    throw new RangeError('MIDI variable-length value exceeds four bytes.');
}

export function uint16BigEndian(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError('Value does not fit uint16.');
    return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

export function uint32BigEndian(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Value does not fit uint32.');
    return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

export function readUint16BigEndian(input, offset) {
    const bytes = toUint8Array(input);
    if (offset < 0 || offset + 2 > bytes.length) throw new RangeError('uint16 read is outside the byte array.');
    return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readUint32BigEndian(input, offset) {
    const bytes = toUint8Array(input);
    if (offset < 0 || offset + 4 > bytes.length) throw new RangeError('uint32 read is outside the byte array.');
    return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
