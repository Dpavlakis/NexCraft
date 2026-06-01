// Minimal Minecraft Java "Server List Ping" (SLP) helpers for the wake listener.
// We only need to: parse a client Handshake (to read next-state + protocol),
// answer a Status Request with a JSON status, and answer a Login Start with a
// disconnect message. Packets are VarInt-length-framed. No full protocol/proxy.

export function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0; // treat as unsigned 32-bit
  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

// Read a VarInt at `offset`. Returns null if the buffer doesn't yet hold a full
// VarInt (caller should wait for more data). Throws if it exceeds 5 bytes.
export function readVarInt(
  buf: Buffer,
  offset: number
): { value: number; size: number } | null {
  let numRead = 0;
  let result = 0;
  let read: number;
  do {
    if (offset + numRead >= buf.length) return null; // incomplete
    read = buf[offset + numRead];
    result |= (read & 0x7f) << (7 * numRead);
    numRead++;
    if (numRead > 5) throw new Error("VarInt too big");
  } while ((read & 0x80) !== 0);
  return { value: result >>> 0, size: numRead };
}

export interface ParsedHandshake {
  nextState: number; // 1 = status, 2 = login
  protocolVersion: number;
  totalConsumed: number; // bytes consumed for the whole handshake packet
}

// Try to parse a Handshake packet from the start of `buf`. Returns null if the
// buffer doesn't yet contain a complete handshake (wait for more data).
// Handshake = len:VarInt, id:VarInt(0x00), protocol:VarInt, addr:String, port:u16, nextState:VarInt
export function parseHandshake(buf: Buffer): ParsedHandshake | null {
  const lenField = readVarInt(buf, 0);
  if (!lenField) return null;
  const packetLen = lenField.value;
  const headerSize = lenField.size;
  if (buf.length < headerSize + packetLen) return null; // full packet not arrived
  let p = headerSize;
  const id = readVarInt(buf, p);
  if (!id) return null;
  p += id.size;
  if (id.value !== 0x00) {
    // Not a handshake (could be a legacy 0xFE ping). Signal "consume all" so the
    // caller still wakes + closes.
    return { nextState: 1, protocolVersion: 0, totalConsumed: headerSize + packetLen };
  }
  const proto = readVarInt(buf, p);
  if (!proto) return null;
  p += proto.size;
  const addrLen = readVarInt(buf, p);
  if (!addrLen) return null;
  p += addrLen.size + addrLen.value; // skip the server-address string
  p += 2; // skip the u16 port
  const nextState = readVarInt(buf, p);
  if (!nextState) return null;
  return {
    nextState: nextState.value,
    protocolVersion: proto.value,
    totalConsumed: headerSize + packetLen
  };
}

// Build a Status Response packet (id 0x00 in status state) carrying the JSON.
export function buildStatusResponse(opts: {
  motd: string;
  protocol: number;
  versionName?: string;
}): Buffer {
  const json = JSON.stringify({
    version: { name: opts.versionName ?? "Sleeping", protocol: opts.protocol || 0 },
    players: { max: 0, online: 0, sample: [] },
    description: { text: opts.motd }
  });
  const jsonBuf = Buffer.from(json, "utf8");
  const body = Buffer.concat([writeVarInt(0x00), writeVarInt(jsonBuf.length), jsonBuf]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

// Build a Login Disconnect packet (id 0x00 in login state) carrying a chat JSON.
export function buildLoginDisconnect(motd: string): Buffer {
  const json = JSON.stringify({ text: motd });
  const jsonBuf = Buffer.from(json, "utf8");
  const body = Buffer.concat([writeVarInt(0x00), writeVarInt(jsonBuf.length), jsonBuf]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
