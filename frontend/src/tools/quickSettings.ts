import { computed, reactive } from "vue";

export type QuickEdition = "java" | "bedrock";
export type QuickValue = string | boolean;
export type QuickProperties = Record<string, unknown>;
export interface QuickTarget {
  uuid: string;
  daemonId: string;
  type: string;
}
export interface QuickField {
  key: string;
  label: string;
  group: "gameplay" | "access" | "world";
  kind: "mode" | "difficulty" | "boolean" | "integer";
  value: QuickValue;
}
const own = (object: QuickProperties, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);
const modes = ["survival", "creative", "adventure", "spectator"];
const difficulties = ["peaceful", "easy", "normal", "hard"];
const LONG = "<__long__>";

export function quickEdition(type: string): QuickEdition | undefined {
  if (type === "minecraft/bedrock" || type === "minecraft/bedrock/bds") return "bedrock";
  if (
    (type === "minecraft/java" || type.startsWith("minecraft/java/")) &&
    !/^minecraft\/java\/(velocity|bungeecord|geyser)(\/|$)/.test(type)
  )
    return "java";
}

function integerText(value: unknown): string | undefined {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
      ? value.replace(/^<__long__>/, "").trim()
      : "";
  return /^[+-]?\d+$/.test(text) ? BigInt(text).toString() : undefined;
}

function normalize(
  kind: QuickField["kind"],
  value: unknown,
  edition: QuickEdition
): QuickValue | undefined {
  if (kind === "integer") return integerText(value);
  if (kind === "boolean") {
    if (
      value === true ||
      value === 1 ||
      (typeof value === "string" && /^(true|1)$/i.test(value.trim()))
    )
      return true;
    if (
      value === false ||
      value === 0 ||
      (typeof value === "string" && /^(false|0)$/i.test(value.trim()))
    )
      return false;
    return;
  }
  const options = kind === "mode" ? modes.slice(0, edition === "bedrock" ? 3 : 4) : difficulties;
  const text = String(value).toLowerCase().trim();
  return options.includes(text) ? text : /^\d$/.test(text) ? options[Number(text)] : undefined;
}

export function quickFields(type: string, properties: QuickProperties): QuickField[] {
  const edition = quickEdition(type);
  if (!edition) return [];
  const candidates: Array<Omit<QuickField, "value">> = [
    { key: "gamemode", label: "gamemode", group: "gameplay", kind: "mode" },
    { key: "difficulty", label: "difficulty", group: "gameplay", kind: "difficulty" },
    ...(edition === "java"
      ? [{ key: "pvp", label: "pvp", group: "gameplay" as const, kind: "boolean" as const }]
      : []),
    {
      key: edition === "java" ? "white-list" : "allow-list",
      label: "allowlist",
      group: "access",
      kind: "boolean"
    },
    { key: "max-players", label: "maxPlayers", group: "access", kind: "integer" },
    { key: "view-distance", label: "viewDistance", group: "world", kind: "integer" },
    {
      key: edition === "java" ? "simulation-distance" : "tick-distance",
      label: "simulationDistance",
      group: "world",
      kind: "integer"
    }
  ];
  return candidates.flatMap((field) => {
    if (!own(properties, field.key)) return [];
    const value = normalize(field.kind, properties[field.key], edition);
    return value === undefined ? [] : [{ ...field, value }];
  });
}

export function quickValidation(
  type: string,
  field: QuickField,
  value: QuickValue
): string | undefined {
  if (field.kind !== "integer") {
    return normalize(field.kind, value, quickEdition(type)!) === value ? undefined : "value";
  }
  const text = integerText(value);
  if (text === undefined) return "integer";
  const number = BigInt(text);
  if (field.key === "max-players") return number > 0n ? undefined : "positive";
  if (quickEdition(type) === "bedrock") {
    if (field.key === "tick-distance")
      return number >= 4n && number <= 12n ? undefined : "bedrockSimulation";
    return number >= 5n ? undefined : "bedrockView";
  }
  // Paper's documented limits are not universal limits for modded Java servers.
  if (type === "minecraft/java/paper")
    return number >= 3n && number <= 32n ? undefined : "paperDistance";
  return number > 0n ? undefined : "positive";
}

function represent(field: QuickField, value: QuickValue, original: unknown): unknown {
  if (field.kind === "integer") {
    const text = integerText(value)!;
    if (typeof original === "string") return original.startsWith(LONG) ? LONG + text : text;
    return Number.isSafeInteger(Number(text)) ? Number(text) : LONG + text;
  }
  if (field.kind === "boolean") {
    if (typeof original === "number") return value ? 1 : 0;
    if (typeof original === "string") {
      if (/^[01]$/.test(original.trim())) return value ? "1" : "0";
      return original.trim() === original.trim().toUpperCase()
        ? String(value).toUpperCase()
        : String(value);
    }
    return value;
  }
  const options = field.kind === "mode" ? modes : difficulties;
  if (typeof original === "number") return options.indexOf(String(value));
  if (typeof original === "string" && /^\d$/.test(original.trim()))
    return String(options.indexOf(String(value)));
  return value;
}

export class QuickConflict extends Error {
  constructor(public keys: string[]) {
    super("conflict");
  }
}

export function mergeQuickSettings(
  type: string,
  baseline: QuickProperties,
  fresh: QuickProperties,
  changes: Record<string, QuickValue>
) {
  const fields = quickFields(type, baseline);
  const merged = { ...fresh };
  const conflicts: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const field = fields.find((item) => item.key === key);
    if (!field || quickValidation(type, field, value)) throw new Error("validation");
    if (!own(fresh, key) || !Object.is(fresh[key], baseline[key])) conflicts.push(key);
    else merged[key] = represent(field, value, baseline[key]);
  }
  if (conflicts.length) throw new QuickConflict(conflicts);
  return merged;
}

interface QuickDependencies {
  readType: (target: QuickTarget, signal: AbortSignal) => Promise<string>;
  read: (target: QuickTarget, signal: AbortSignal) => Promise<unknown>;
  write: (target: QuickTarget, properties: QuickProperties) => Promise<unknown>;
  confirm: () => Promise<boolean>;
}
class QuickConfigReadError extends Error {}
function propertiesObject(value: unknown): QuickProperties {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]")
    throw new QuickConfigReadError("format");
  return { ...value };
}

/** One context owns each read, confirmation and acknowledgement. Writes are never replayed. */
export function createQuickSettings(deps: QuickDependencies) {
  const state = reactive({
    target: undefined as QuickTarget | undefined,
    baseline: {} as QuickProperties,
    draft: {} as Record<string, QuickValue>,
    loading: false,
    saving: false,
    ready: false,
    error: "",
    errorDetail: "",
    conflicts: [] as string[],
    saved: false
  });
  let generation = 0;
  let active = true;
  let controller: AbortController | undefined;
  let identity: QuickTarget | undefined;
  const fields = computed(() => quickFields(state.target?.type ?? "", state.baseline));
  const changes = computed(
    () =>
      Object.fromEntries(
        fields.value.flatMap((field) => {
          const value = state.draft[field.key];
          const normalized = field.kind === "integer" ? integerText(value) : value;
          return normalized === field.value ? [] : [[field.key, value]];
        })
      ) as Record<string, QuickValue>
  );
  const validation = computed(() =>
    Object.fromEntries(
      fields.value.flatMap((field) => {
        // Validate only edited values; loading an older/modded file must never clamp it.
        if (!own(changes.value, field.key)) return [];
        const error = quickValidation(state.target!.type, field, state.draft[field.key]);
        return error ? [[field.key, error]] : [];
      })
    )
  );
  const busy = computed(() => state.loading || state.saving);
  const current = (epoch: number) => active && generation === epoch;
  const accept = (properties: QuickProperties) => {
    state.baseline = properties;
    state.draft = Object.fromEntries(
      quickFields(state.target!.type, properties).map((field) => [field.key, field.value])
    );
    state.ready = true;
  };
  const invalidate = () => {
    generation++;
    controller?.abort();
    state.loading = false;
    state.saving = false;
  };
  const load = async () => {
    if (!active || busy.value) return;
    invalidate();
    const epoch = generation;
    const target = identity && { ...identity };
    state.ready = false;
    state.saved = false;
    state.error = "";
    state.errorDetail = "";
    state.conflicts = [];
    state.baseline = {};
    state.draft = {};
    state.target = undefined;
    if (!target?.uuid || !target.daemonId) {
      state.error = "context";
      return;
    }
    state.loading = true;
    const signal = (controller = new AbortController()).signal;
    try {
      const type = await deps.readType(target, signal);
      if (!current(epoch)) return;
      target.type = type;
      state.target = { ...target };
      if (!quickEdition(type)) {
        state.error = "unsupported";
        return;
      }
      const properties = await deps.read(target, signal);
      if (!current(epoch)) return;
      accept(propertiesObject(properties));
    } catch (error) {
      if (current(epoch)) {
        state.error = error instanceof QuickConfigReadError ? "format" : "load";
        state.errorDetail =
          error instanceof QuickConfigReadError
            ? ""
            : error instanceof Error
            ? error.message
            : String(error);
      }
    } finally {
      if (current(epoch)) state.loading = false;
    }
  };
  const setTarget = async (target: QuickTarget) => {
    invalidate();
    identity = { ...target };
    await load();
  };
  const edit = (key: string, value: QuickValue) => {
    if (busy.value || !state.ready || !fields.value.some((field) => field.key === key)) return;
    state.draft[key] = value;
    state.saved = false;
  };
  const save = async () => {
    if (
      !active ||
      busy.value ||
      !state.ready ||
      !state.target ||
      !Object.keys(changes.value).length ||
      Object.keys(validation.value).length
    )
      return;
    const epoch = generation;
    const target = { ...state.target };
    const baseline = { ...state.baseline };
    const dirty = { ...changes.value };
    state.saving = true;
    state.saved = false;
    state.error = "";
    state.errorDetail = "";
    state.conflicts = [];
    const signal = (controller = new AbortController()).signal;
    try {
      if (!(await deps.confirm()) || !current(epoch)) return;
      const type = await deps.readType(target, signal);
      if (!current(epoch)) return;
      if (type !== target.type) {
        state.ready = false;
        state.error = "context";
        return;
      }
      const fresh = await deps.read(target, signal);
      if (!current(epoch)) return;
      const merged = mergeQuickSettings(type, baseline, propertiesObject(fresh), dirty);
      // Legacy whole-object PUT is not an atomic CAS; another writer can race after this read.
      const ack = await deps.write(target, merged);
      if (!current(epoch)) return;
      if (ack !== true) {
        state.error = "ack";
        return;
      }
      accept(merged);
      state.saved = true;
    } catch (error) {
      if (!current(epoch)) return;
      state.error =
        error instanceof QuickConflict
          ? "conflict"
          : error instanceof QuickConfigReadError
          ? "format"
          : "save";
      state.conflicts = error instanceof QuickConflict ? error.keys : [];
      state.errorDetail =
        error instanceof QuickConflict || error instanceof QuickConfigReadError
          ? ""
          : error instanceof Error
          ? error.message
          : String(error);
      if (error instanceof QuickConfigReadError) state.ready = false;
    } finally {
      if (current(epoch)) state.saving = false;
    }
  };
  const dispose = () => {
    active = false;
    invalidate();
  };
  return { state, fields, changes, validation, busy, setTarget, load, edit, save, dispose };
}
