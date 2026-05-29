import fs from "fs-extra";
import path from "path";
import type Instance from "../entity/instance/instance";

// Reads/writes only the `motd` line of a Minecraft server's server.properties,
// providing an "easy MOTD" editor without touching the rest of the file.
// server.properties is a Java .properties file (ISO-8859-1 + \uXXXX escapes);
// for friendliness we also translate `&` colour codes <-> the section sign.

const MOTD_RE = /^motd\s*=(.*)$/m;
const SECTION = "§";

// Encode a user-entered MOTD into a .properties-safe value.
function escapePropValue(input: string): string {
  // Normalise newlines, then translate `&<code>` to the section sign so colours work.
  const normalised = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&([0-9a-fk-orA-FK-OR])/g, `${SECTION}$1`);

  let out = "";
  for (const ch of normalised) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n") out += "\\n";
    else if (ch === "\\") out += "\\\\";
    else if (code < 0x20 || code > 0x7e) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out;
}

// Decode a .properties value back into a friendly, editable MOTD string.
function unescapePropValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      const n = value[i + 1];
      if (n === "u" && /^[0-9a-fA-F]{4}$/.test(value.substr(i + 2, 4))) {
        out += String.fromCharCode(parseInt(value.substr(i + 2, 4), 16));
        i += 5;
      } else if (n === "n" || n === "r") {
        out += "\n";
        i += 1;
      } else if (n === "t") {
        out += "\t";
        i += 1;
      } else {
        out += n;
        i += 1;
      }
    } else {
      out += c;
    }
  }
  // Show colour codes in the friendly `&` form.
  return out.split(SECTION).join("&");
}

function propsPath(instance: Instance): string {
  return path.join(instance.absoluteCwdPath(), "server.properties");
}

export function getMotd(instance: Instance): string {
  const file = propsPath(instance);
  if (!fs.existsSync(file)) return "";
  let txt = "";
  try {
    txt = fs.readFileSync(file, "latin1");
  } catch {
    return "";
  }
  const m = txt.match(MOTD_RE);
  return m ? unescapePropValue(m[1].trim()) : "";
}

export function setMotd(instance: Instance, motd: string): void {
  const file = propsPath(instance);
  const value = escapePropValue(String(motd ?? ""));

  // Don't create a server.properties just to write an empty MOTD.
  if (!fs.existsSync(file)) {
    if (value === "") return;
    fs.writeFileSync(file, `motd=${value}\n`, "latin1");
    return;
  }

  let txt = "";
  try {
    txt = fs.readFileSync(file, "latin1");
  } catch {
    txt = "";
  }
  if (MOTD_RE.test(txt)) {
    // Use a replacer function so `$` in the value isn't treated as a
    // special replacement pattern (e.g. $&, $1).
    txt = txt.replace(MOTD_RE, () => `motd=${value}`);
  } else {
    txt = (txt && !txt.endsWith("\n") ? txt + "\n" : txt) + `motd=${value}\n`;
  }
  fs.writeFileSync(file, txt, "latin1");
}
