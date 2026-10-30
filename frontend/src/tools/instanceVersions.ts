/** Provider IDs are opaque. Only release-list position (or published dates) establishes order. */
export interface InstalledPackVersion {
  source?: string;
  projectId?: string;
  fileId?: string;
  versionName?: string;
  mcVersion?: string;
  loader?: string;
}

export interface InstanceRelease {
  fileId?: string;
  id?: string;
  displayName?: string;
  name?: string;
  version_number?: string;
  mcVersion?: string;
  game_versions?: string[];
  loader?: string;
  loaders?: string[];
  hasServerPack?: boolean;
  releaseType?: number;
  version_type?: string;
  type?: string;
  fileDate?: string;
  date_published?: string;
  releaseTime?: string;
}

export type InstanceUpdateStatus =
  | "loading"
  | "available"
  | "current"
  | "unknown"
  | "unsupported"
  | "error";

export interface InstanceUpdateResult {
  status: InstanceUpdateStatus;
  latest?: InstanceRelease;
}

export interface InstanceVersionTarget {
  source: "curseforge" | "modrinth" | "bedrock";
  projectId: string;
}

export function getInstanceVersionTarget(
  pack?: InstalledPackVersion
): InstanceVersionTarget | undefined {
  if (pack?.source === "bedrock") return { source: "bedrock", projectId: "bds" };
  if ((pack?.source === "curseforge" || pack?.source === "modrinth") && pack.projectId) {
    return { source: pack.source, projectId: pack.projectId };
  }
}

export function instanceReleaseId(release: InstanceRelease, source: string): string {
  return String((source === "curseforge" ? release.fileId : release.id) || "");
}

function releaseChannel(release: InstanceRelease): string {
  return (
    ({ 1: "release", 2: "beta", 3: "alpha" } as Record<number, string>)[release.releaseType ?? 0] ||
    release.version_type ||
    release.type ||
    ""
  );
}

function gameVersions(release: InstanceRelease): string[] {
  return release.game_versions?.length
    ? release.game_versions
    : release.mcVersion
    ? [release.mcVersion]
    : [];
}

function loaders(release: InstanceRelease, source: string): string[] {
  return (release.loaders?.length ? release.loaders : release.loader ? [release.loader] : [])
    .map((loader) => loader.toLowerCase())
    .filter((loader) => source !== "curseforge" || loader !== "vanilla");
}

function publishedAt(release: InstanceRelease): number {
  return Date.parse(release.fileDate || release.date_published || release.releaseTime || "");
}

/** Sort stably when every row has a date; otherwise retain the provider's newest-first order. */
export function orderInstanceReleases<T extends InstanceRelease>(releases: readonly T[]): T[] {
  const rows = releases.slice();
  if (rows.length && rows.every((row) => Number.isFinite(publishedAt(row)))) {
    rows.sort((a, b) => publishedAt(b) - publishedAt(a));
  }
  return rows;
}

export function selectInstanceUpdate(
  pack: InstalledPackVersion | undefined,
  releases: readonly InstanceRelease[]
): InstanceUpdateResult {
  if (!pack?.source) return { status: "unknown" };
  if (!["curseforge", "modrinth", "bedrock"].includes(pack.source || "")) {
    return { status: "unsupported" };
  }
  if (!getInstanceVersionTarget(pack)) return { status: "unknown" };
  const source = pack.source!;
  const installedId = source === "bedrock" ? pack.mcVersion : pack.fileId;
  if (!installedId) return { status: "unknown" };
  const ordered = orderInstanceReleases(releases);
  const index = ordered.findIndex((release) => instanceReleaseId(release, source) === installedId);
  // A truncated list cannot establish whether an absent installed release is older or newer.
  if (index < 0) return { status: "unknown" };
  const current = ordered[index];
  const channel = releaseChannel(current);
  if (!channel) return { status: "unknown" };
  // Concrete persisted provenance must agree with the exact installed provider release.
  const currentMc = gameVersions(current);
  const currentLoaders = loaders(current, source);
  // CF installation reads the server-pack tags, whereas this list describes its client release.
  // The panel defaults absent CF loader tags to "vanilla". That fallback is missing evidence,
  // not a concrete conflicting loader. Resolve it only from the exact installed provider ID.
  const persistedLoader = pack.loader?.toLowerCase();
  const knownLoader =
    source === "curseforge" && persistedLoader === "vanilla" ? undefined : persistedLoader;
  // Supported client loaders do not identify the installed server loader when several differ.
  // loaders() already folds case, so repeated tags still provide one unambiguous fallback.
  if (source === "curseforge" && !knownLoader && new Set(currentLoaders).size > 1) {
    return { status: "unknown" };
  }
  if (
    source !== "bedrock" &&
    ((pack.mcVersion && currentMc.length && !currentMc.includes(pack.mcVersion)) ||
      (knownLoader && currentLoaders.length && !currentLoaders.includes(knownLoader)))
  )
    return { status: "unknown" };
  const mc = pack.mcVersion ? [pack.mcVersion] : currentMc;
  const installedLoaders = knownLoader ? [knownLoader] : currentLoaders;
  if (source !== "bedrock" && (!mc.length || !installedLoaders.length)) {
    return { status: "unknown" };
  }
  let uncertain = false;
  for (const candidate of ordered.slice(0, index)) {
    if (!instanceReleaseId(candidate, source)) {
      uncertain = true;
      continue;
    }
    // Server packs are required by the CurseForge update flow.
    if (source === "curseforge" && candidate.hasServerPack !== true) {
      if (candidate.hasServerPack === undefined) uncertain = true;
      continue;
    }
    const candidateChannel = releaseChannel(candidate);
    if (!candidateChannel) {
      uncertain = true;
      continue;
    }
    if (candidateChannel !== channel) continue;
    if (source !== "bedrock") {
      const candidateMc = gameVersions(candidate);
      const candidateLoaders = loaders(candidate, source);
      if (candidateMc.length && !candidateMc.some((version) => mc.includes(version))) continue;
      if (
        candidateLoaders.length &&
        !candidateLoaders.some((loader) => installedLoaders.includes(loader))
      )
        continue;
      if (!candidateMc.length || !candidateLoaders.length) {
        uncertain = true;
        continue;
      }
    }
    // With mixed/missing dates we retain provider order, but never contradict known dates.
    const candidateDate = publishedAt(candidate);
    const currentDate = publishedAt(current);
    if (Number.isFinite(candidateDate) && Number.isFinite(currentDate)) {
      if (candidateDate < currentDate) continue;
      if (candidateDate === currentDate) {
        uncertain = true;
        continue;
      }
    }
    return { status: "available", latest: candidate };
  }
  return { status: uncertain ? "unknown" : "current" };
}

export function installedInstanceVersions(
  pack: InstalledPackVersion | undefined,
  live?: { mcPingOnline?: boolean; version?: string }
) {
  const isBedrock = pack?.source === "bedrock";
  const isModpack = ["curseforge", "modrinth", "ftb"].includes(pack?.source || "");
  return {
    isModpack,
    isBedrock,
    packVersion: isModpack ? pack?.versionName || undefined : undefined,
    minecraftVersion: pack?.mcVersion || undefined,
    bdsVersion: isBedrock ? pack?.versionName || pack.mcVersion || undefined : undefined,
    // Runtime ping describes a live server, never persisted installed provenance.
    liveVersion: !pack?.mcVersion && live?.mcPingOnline ? live.version || undefined : undefined
  };
}
