import axios from "axios";

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string;
  body: string;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  author_id: string;
  name: string;
  version_number: string;
}

class ModManagerService {
  private readonly baseUrl = "https://api.modrinth.com/v2";
  private readonly curseforgeUrl = "https://api.curse.tools";
  private readonly MAX_CACHE_SIZE = 1000;
  private cache = new Map<string, any>();
  private mcVersionsCache: string[] = [];
  private mcVersionsLastFetch = 0;

  constructor() {
    setInterval(() => {
      this.mcVersionsCache = [];
      this.mcVersionsLastFetch = 0;
      this.cache.clear();
    }, 1000 * 60 * 60 * 24);
  }

  private setCache(key: string, value: any) {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  public async getMinecraftVersions() {
    const now = Date.now();
    if (this.mcVersionsCache.length > 0 && now - this.mcVersionsLastFetch < 1000 * 60 * 60 * 24) {
      return this.mcVersionsCache;
    }

    try {
      // Try Modrinth first
      const res = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/tag/game_version`
      });
      const versions = res.data
        .filter((v: any) => v.project_type === "minecraft" && /^\d+\.\d+(\.\d+)?$/.test(v.version))
        .map((v: any) => v.version)
        .sort((a: string, b: string) => {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] || 0;
            const vb = pb[i] || 0;
            if (va !== vb) return vb - va;
          }
          return 0;
        });

      if (versions.length > 0) {
        this.mcVersionsCache = versions;
        this.mcVersionsLastFetch = now;
        return versions;
      }
    } catch (err) {
      console.error("Failed to fetch MC versions from Modrinth:", err);
    }

    try {
      // Try Mojang official manifest as fallback
      const res = await this.requestWithRetry({
        method: "GET",
        url: "https://launchermeta.mojang.com/mc/game/version_manifest.json"
      });
      const versions = res.data.versions
        .filter((v: any) => v.type === "release")
        .map((v: any) => v.id)
        .filter((v: string) => /^\d+\.\d+(\.\d+)?$/.test(v))
        .sort((a: string, b: string) => {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] || 0;
            const vb = pb[i] || 0;
            if (va !== vb) return vb - va;
          }
          return 0;
        });

      if (versions.length > 0) {
        this.mcVersionsCache = versions;
        this.mcVersionsLastFetch = now;
        return versions;
      }
    } catch (err: any) {
      console.error("Failed to fetch MC versions from Mojang!", err?.message);
    }

    // Fallback to a reasonable list if all APIs fail
    return [
      "1.21",
      "1.20.6",
      "1.20.4",
      "1.20.1",
      "1.19.4",
      "1.19.2",
      "1.18.2",
      "1.17.1",
      "1.16.5",
      "1.12.2"
    ];
  }

  public async getInfoByHash(hash: string) {
    if (this.cache.has(hash)) return this.cache.get(hash);

    try {
      // 1. Get version by hash
      const versionRes = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/version_file/${hash}?algorithm=sha1`
      });
      const versionData = versionRes.data;

      // 2. Get project by project_id
      const projectRes = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/project/${versionData.project_id}`
      });
      const projectData = projectRes.data;

      const result = {
        version: versionData,
        project: projectData
      };

      this.setCache(hash, result);
      return result;
    } catch (err) {
      return null;
    }
  }

  private async requestWithRetry(config: any, retries = 2): Promise<any> {
    try {
      return await axios({
        ...config,
        timeout: config.timeout || 5000
      });
    } catch (err: any) {
      const isNetworkError =
        !err.response &&
        (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNABORTED");
      const isRetryableStatus =
        err.response?.status === 500 ||
        err.response?.status === 502 ||
        err.response?.status === 504;

      if (retries > 0 && (isNetworkError || isRetryableStatus)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return await this.requestWithRetry(config, retries - 1);
      }
      throw err;
    }
  }

  public async getInfosByHashes(hashes: string[]) {
    const result: Record<string, any> = {};
    const missingHashes: string[] = [];

    if (hashes.length > 50) {
      throw new Error("Hashes length cannot be greater than 50");
    }

    for (const hash of hashes) {
      if (this.cache.has(hash)) {
        result[hash] = this.cache.get(hash);
      } else {
        missingHashes.push(hash);
      }
    }

    if (missingHashes.length > 0) {
      // Split into chunks of 50 to avoid Modrinth database timeouts
      const chunkSize = 50;
      for (let i = 0; i < missingHashes.length; i += chunkSize) {
        const chunk = missingHashes.slice(i, i + chunkSize);
        try {
          const res = await this.requestWithRetry({
            method: "POST",
            url: `${this.baseUrl}/version_files`,
            data: {
              hashes: chunk,
              algorithm: "sha1"
            }
          });

          const versionsMap = res.data;
          const projectIds = new Set<string>();
          for (const hash in versionsMap) {
            projectIds.add(versionsMap[hash].project_id);
          }

          if (projectIds.size > 0) {
            const projectsRes = await this.requestWithRetry({
              method: "GET",
              url: `${this.baseUrl}/projects`,
              params: { ids: JSON.stringify(Array.from(projectIds)) }
            });
            const projects = projectsRes.data;
            const projectsMap = projects.reduce((acc: any, p: any) => {
              acc[p.id] = p;
              return acc;
            }, {});

            for (const hash in versionsMap) {
              const version = versionsMap[hash];
              const project = projectsMap[version.project_id];
              const info = { version, project };
              this.setCache(hash, info);
              result[hash] = info;
            }
          }
        } catch (err: any) {
          console.error(`Modrinth batch lookup error for chunk ${i / chunkSize}:`, err?.message);
        }
      }
    }

    return result;
  }

  private cleanCurseForgeVersionName(vn: string, projectName?: string): string {
    if (!vn) return "Unknown";
    // Remove file extensions
    vn = vn.replace(/\.(jar|zip)(\.disabled)?$/i, "");

    // Remove common prefixes like "v" or "version-"
    vn = vn.replace(/^(v|version)[-_\s.]+/i, "");

    if (projectName) {
      // Normalize project name: remove spaces, special chars, and common suffixes
      // Also handle special characters like "!" in "ALBOE!"
      const normalizedProjectName = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .replace(/(mod|plugin|forge|fabric|quilt|neoforge)$/, "");

      const cleanVn = vn.toLowerCase().replace(/[^a-z0-9]/g, "");

      if (normalizedProjectName.length > 0 && cleanVn.startsWith(normalizedProjectName)) {
        // Find how many characters to skip in the original string
        let skip = 0;
        let matched = 0;
        while (skip < vn.length && matched < normalizedProjectName.length) {
          const char = vn[skip].toLowerCase().replace(/[^a-z0-9]/g, "");
          if (char === normalizedProjectName[matched]) {
            matched++;
          }
          skip++;
        }
        const stripped = vn.substring(skip).replace(/^[-_\s.]+/, "");
        // Only return stripped if it's not empty and looks like a version
        if (stripped.length >= 1) vn = stripped;
      }
    }

    // Final cleanup: if it's just a bunch of numbers and dots/dashes, it's probably fine
    // Handle cases like "1.21.1-1.0.0" -> "1.0.0" if the first part is a game version
    const gameVersionMatch = vn.match(/^(\d+\.\d+(\.\d+)?)[-_\s]+(.+)$/);
    if (gameVersionMatch) {
      const potentialVersion = gameVersionMatch[3];
      // If the remaining part starts with a number, it's likely the actual version
      if (/^\d+/.test(potentialVersion)) {
        vn = potentialVersion;
      }
    }

    // If the result is still the same as the original (minus extension),
    // and it's very long/ugly, try a more aggressive approach
    if (vn.includes("-") || vn.includes("_")) {
      const parts = vn.split(/[-_\s]+/);
      // If the last part looks like a version number (e.g., 0.0.8), maybe just use that?
      // But that's risky. Let's stick to the current logic but ensure it's robust.
    }

    return vn;
  }

  // --- Modpack search cache (pre-warmed on startup, refreshed periodically) ---
  private searchCache = new Map<string, { data: any; expires: number }>();
  private readonly SEARCH_TTL_MS = 15 * 60 * 1000;

  private searchCacheKey(
    query: string,
    offset: number,
    limit: number,
    filters?: {
      source?: string;
      version?: string;
      type?: string;
      loader?: string;
      environment?: string;
      sort?: string;
    }
  ) {
    const f = filters || {};
    return [
      (query || "").trim().toLowerCase(),
      offset,
      limit,
      f.source || "all",
      f.version || "all",
      f.type || "",
      f.loader || "all",
      f.environment || "all",
      f.sort || "featured"
    ].join("|");
  }

  // Cached entry point used by the router. Serves non-empty results from memory
  // for SEARCH_TTL_MS so the modpack browser loads instantly and we don't hammer
  // CurseForge/Modrinth on every tab open.
  public async searchProjects(
    query: string,
    offset = 0,
    limit = 20,
    filters?: {
      source?: string;
      version?: string;
      type?: string;
      loader?: string;
      environment?: string;
      sort?: string;
    }
  ) {
    const key = this.searchCacheKey(query, offset, limit, filters);
    const now = Date.now();
    const hit = this.searchCache.get(key);
    if (hit && hit.expires > now) return hit.data;

    const data = await this.searchProjectsUncached(query, offset, limit, filters);
    // Only cache non-empty results so a transient API hiccup isn't cached.
    if (data && Array.isArray(data.hits) && data.hits.length > 0) {
      if (this.searchCache.size > 200) {
        const firstKey = this.searchCache.keys().next().value;
        if (firstKey) this.searchCache.delete(firstKey);
      }
      this.searchCache.set(key, { data, expires: now + this.SEARCH_TTL_MS });
    }
    return data;
  }

  // Pre-warm + periodically refresh the default modpack lists (empty query,
  // featured sort) for CurseForge and Modrinth so the first browse is instant.
  private async refreshDefaultModpackCache() {
    for (const source of ["curseforge", "modrinth"]) {
      try {
        const filters = {
          source,
          version: "all",
          type: "modpack",
          loader: "all",
          environment: "all",
          sort: "featured"
        };
        const data = await this.searchProjectsUncached("", 0, 30, filters);
        if (data && Array.isArray(data.hits) && data.hits.length > 0) {
          this.searchCache.set(this.searchCacheKey("", 0, 30, filters), {
            data,
            expires: Date.now() + this.SEARCH_TTL_MS
          });
        }
      } catch {
        // ignore — retried on the next interval, and lazily on demand
      }
    }
  }

  public startModpackCacheWarmer() {
    this.refreshDefaultModpackCache();
    setInterval(() => this.refreshDefaultModpackCache(), 10 * 60 * 1000);
  }

  private async searchProjectsUncached(
    query: string,
    offset = 0,
    limit = 20,
    filters?: {
      source?: string;
      version?: string;
      type?: string;
      loader?: string;
      environment?: string;
      sort?: string;
    }
  ) {
    if (limit > 50) throw new Error("Limit cannot be greater than 100");
    const source = filters?.source || "all";

    if (source === "modrinth") {
      return await this.searchModrinth(query, offset, limit, filters);
    }

    if (source === "ftb") {
      return await this.searchFTB(query, offset, limit);
    }

    if (source === "curseforge") {
      return await this.searchCurseForge(query, offset, limit, filters);
    }

    if (source === "spigotmc") {
      return await this.searchSpigotMC(query, offset, limit, filters);
    }

    // Search all sources
    try {
      let N = 3;
      let spigotPromise: Promise<any>;

      if (filters?.type === "mod") {
        N = 2;
        spigotPromise = Promise.resolve({ hits: [], total_hits: 0 });
      } else {
        spigotPromise = this.searchSpigotMC(
          query,
          Math.floor((offset + 2) / N),
          Math.floor((offset + limit + 2) / N) - Math.floor((offset + 2) / N),
          filters
        );
      }

      const [modrinthRes, curseforgeRes, spigotRes] = await Promise.all([
        this.searchModrinth(
          query,
          Math.floor((offset + 0) / N),
          Math.floor((offset + limit + 0) / N) - Math.floor((offset + 0) / N),
          filters
        ),
        this.searchCurseForge(
          query,
          Math.floor((offset + 1) / N),
          Math.floor((offset + limit + 1) / N) - Math.floor((offset + 1) / N),
          filters
        ),
        spigotPromise
      ]);

      const hits = [
        ...(modrinthRes?.hits || []),
        ...(curseforgeRes?.hits || []),
        ...(spigotRes?.hits || [])
      ];

      const total_hits =
        (modrinthRes?.total_hits || 0) +
        (curseforgeRes?.total_hits || 0) +
        (spigotRes?.total_hits || 0);

      return { hits, total_hits };
    } catch (err) {
      console.error("Search all error:", err);
      return { hits: [], total_hits: 0 };
    }
  }

  public async searchModrinth(
    query: string,
    offset = 0,
    limit = 20,
    filters?: { version?: string; type?: string; loader?: string; environment?: string; sort?: string }
  ) {
    try {
      const facets: string[][] = [];
      if (filters?.version) {
        facets.push([`versions:${filters.version}`]);
      }
      if (filters?.type && filters.type !== "all") {
        if (filters.type === "plugin") {
          facets.push(["project_type:mod"]);
          // If no specific loader is selected, filter by common plugin categories
          if (!filters.loader || filters.loader === "all") {
            facets.push([
              "categories:Spigot",
              "categories:Paper",
              "categories:Purpur",
              "categories:Folia",
              "categories:BungeeCord",
              "categories:Velocity",
              "categories:Waterfall"
            ]);
          }
        } else {
          facets.push([`project_type:${filters.type}`]);
        }
      }

      // Handle loaders (Forge, Fabric, etc.) - use categories facet
      if (filters?.loader && filters.loader !== "all") {
        const loaderMap: Record<string, string> = {
          forge: "Forge",
          fabric: "Fabric",
          quilt: "Quilt",
          neoforge: "NeoForge",
          spigot: "Spigot",
          paper: "Paper",
          purpur: "Purpur",
          folia: "Folia",
          bungeecord: "BungeeCord",
          velocity: "Velocity",
          waterfall: "Waterfall"
        };
        const loaderName = loaderMap[filters.loader.toLowerCase()] || filters.loader;
        facets.push([`categories:${loaderName}`]);
      }

      // Handle environment (server/client)
      if (filters?.environment && filters.environment !== "all") {
        if (filters.environment.toLowerCase() === "server") {
          facets.push(["server_side:required", "server_side:optional"]);
        } else if (filters.environment.toLowerCase() === "client") {
          facets.push(["client_side:required", "client_side:optional"]);
        }
      }

      const modrinthIndexMap: Record<string, string> = {
        featured: "relevance",
        popularity: "downloads",
        lastupdated: "updated",
        name: "relevance",
        author: "relevance",
        totaldownloads: "downloads"
      };
      const res = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/search`,
        params: {
          query,
          facets: facets.length > 0 ? JSON.stringify(facets) : undefined,
          index: modrinthIndexMap[(filters?.sort || "featured").toLowerCase()] || "relevance",
          offset,
          limit
        }
      });

      if (!res.data || !res.data.hits) {
        return { hits: [], total_hits: 0 };
      }

      const hits = res.data.hits;
      const versionIds = hits.map((h: any) => h.latest_version).filter((id: any) => !!id);
      let versionsMap: Record<string, string> = {};

      if (versionIds.length > 0) {
        try {
          const versionsRes = await this.requestWithRetry({
            method: "GET",
            url: `${this.baseUrl}/versions`,
            params: { ids: JSON.stringify(versionIds) }
          });
          versionsMap = versionsRes.data.reduce((acc: any, v: any) => {
            acc[v.id] = v.version_number;
            return acc;
          }, {});
        } catch (vErr) {
          console.error("Failed to fetch version numbers for hits:", vErr);
        }
      }

      // Map Modrinth results to a unified format
      const mappedHits = hits.map((hit: any) => {
        // If user explicitly searched for plugins, force the type to plugin
        // Otherwise, try to detect if it's a plugin based on categories
        let projectType = hit.project_type;
        if (filters?.type === "plugin") {
          projectType = "plugin";
        } else {
          const pluginCategories = [
            "spigot",
            "paper",
            "purpur",
            "folia",
            "bungeecord",
            "velocity",
            "waterfall"
          ];
          if (
            projectType === "mod" &&
            hit.categories?.some((c: string) => pluginCategories.includes(c.toLowerCase()))
          ) {
            projectType = "plugin";
          }
        }

        return {
          id: hit.project_id,
          slug: hit.slug,
          title: hit.title,
          description: hit.description,
          icon_url: hit.icon_url,
          author: hit.author,
          downloads: hit.downloads,
          updated: hit.date_modified,
          categories: hit.categories,
          version_number: versionsMap[hit.latest_version] || hit.latest_version,
          game_versions: hit.versions,
          display_categories: hit.display_categories,
          source: "Modrinth",
          project_type: projectType
        };
      });

      // Modrinth's API has no "name"/"author" sort index (they silently fall
      // back to relevance), so sort those client-side on the returned page.
      const sortKey = (filters?.sort || "featured").toLowerCase();
      if (sortKey === "name") {
        mappedHits.sort((a: any, b: any) => String(a.title).localeCompare(String(b.title)));
      } else if (sortKey === "author") {
        mappedHits.sort((a: any, b: any) =>
          String(a.author || "").localeCompare(String(b.author || ""))
        );
      }

      return {
        hits: mappedHits,
        total_hits: res.data.total_hits
      };
    } catch (err) {
      console.error("Modrinth search error:", err);
      return { hits: [], total_hits: 0 };
    }
  }

  // ---- FTB (api.modpacks.ch) ----
  private readonly ftbUrl = "https://api.modpacks.ch/public";
  // Search/popular return only pack IDs; cache the per-query ID list so paging
  // through results doesn't refetch it each page.
  private ftbIdCache = new Map<string, { ids: number[]; expires: number }>();

  private async ftbPackIds(query: string): Promise<number[]> {
    const key = query.trim().toLowerCase();
    const now = Date.now();
    const hit = this.ftbIdCache.get(key);
    if (hit && hit.expires > now) return hit.ids;
    let ids: number[] = [];
    try {
      const url = key
        ? `${this.ftbUrl}/modpack/search/100?term=${encodeURIComponent(key)}`
        : `${this.ftbUrl}/modpack/popular/installs/100`;
      const res = await this.requestWithRetry({ method: "GET", url });
      ids = Array.isArray(res.data?.packs) ? res.data.packs : [];
    } catch (e) {
      ids = [];
    }
    this.ftbIdCache.set(key, { ids, expires: now + 10 * 60 * 1000 });
    return ids;
  }

  private async getFtbPack(id: number): Promise<any> {
    const res = await this.requestWithRetry({ method: "GET", url: `${this.ftbUrl}/modpack/${id}` });
    return res.data;
  }

  private mapFtbHit(p: any) {
    const art = Array.isArray(p.art) ? p.art : [];
    const icon = art.find((a: any) => a.type === "square") || art[0];
    const gv = new Set<string>();
    for (const v of p.versions || []) {
      for (const tg of v.targets || []) {
        if (tg.type === "game" || tg.name === "minecraft") gv.add(tg.version);
      }
    }
    const ts = Number(p.updated || p.released || 0);
    return {
      id: String(p.id),
      title: p.name,
      description: p.synopsis || p.description || "",
      icon_url: icon?.url,
      author: (p.authors || [])[0]?.name || "FTB",
      downloads: p.installs,
      updated: ts ? new Date(ts * 1000).toISOString() : undefined,
      categories: (p.tags || []).map((tg: any) => tg.name).slice(0, 6),
      game_versions: Array.from(gv),
      source: "FTB",
      project_type: "modpack"
    };
  }

  public async searchFTB(query: string, offset = 0, limit = 20) {
    try {
      const ids = await this.ftbPackIds(query);
      const slice = ids.slice(offset, offset + limit);
      const packs = await Promise.all(slice.map((id) => this.getFtbPack(id).catch(() => null)));
      const hits = packs.filter((p) => !!p).map((p) => this.mapFtbHit(p));
      return { hits, total_hits: ids.length };
    } catch (err) {
      console.error("FTB search error:", err);
      return { hits: [], total_hits: 0 };
    }
  }

  // Versions for the install dialog — newest first; every FTB version is server-installable.
  public async getFTBModpackVersions(packId: string) {
    const p = await this.getFtbPack(Number(packId));
    const versions: any[] = Array.isArray(p?.versions) ? p.versions : [];
    return versions
      .slice()
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      .map((v) => {
        let mc = "";
        let loader = "";
        for (const tg of v.targets || []) {
          if (tg.type === "game" || tg.name === "minecraft") mc = tg.version;
          if (tg.type === "modloader") loader = tg.name;
        }
        return {
          fileId: String(v.id),
          id: String(v.id),
          displayName: v.name,
          name: v.name,
          mcVersion: mc,
          loader,
          hasServerPack: true,
          releaseType: v.type === "release" ? 1 : v.type === "beta" ? 2 : 3
        };
      });
  }

  public async searchCurseForge(
    query: string,
    offset = 0,
    limit = 20,
    filters?: { version?: string; type?: string; loader?: string; environment?: string; sort?: string }
  ) {
    try {
      const classIdMap: Record<string, number> = {
        mod: 6,
        plugin: 12,
        modpack: 4471,
        all: 6
      };

      const loaderMap: Record<string, number> = {
        forge: 1,
        fabric: 4,
        quilt: 5,
        neoforge: 6,
        all: 0
      };

      const type = filters?.type || "all";
      const loader = filters?.loader?.toLowerCase() || "all";

      const params: any = {
        gameId: 432,
        searchFilter: query || "",
        index: offset,
        pageSize: limit
      };

      if (type !== "all" && classIdMap[type]) {
        params.classId = classIdMap[type];
      } else if (type === "all") {
        // Default to Mods (6) if searching all, or omit to search everything
        // Most users expect mods when searching "all" on CurseForge
        params.classId = 6;
      }

      if (loader !== "all" && loaderMap[loader]) {
        params.modLoaderType = loaderMap[loader];
      }

      if (filters?.version) {
        params.gameVersion = filters.version;
      }

      // CurseForge sortField: 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads
      const cfSortMap: Record<string, number> = {
        featured: 1,
        popularity: 2,
        lastupdated: 3,
        name: 4,
        author: 5,
        totaldownloads: 6
      };
      const sf = cfSortMap[(filters?.sort || "featured").toLowerCase()] || 1;
      params.sortField = sf;
      params.sortOrder = sf === 4 ? "asc" : "desc";

      const res = await this.requestWithRetry({
        method: "GET",
        url: `${this.curseforgeUrl}/v1/cf/mods/search`,
        params,
        headers: {
          Accept: "application/json",
          "x-api-key": "$2a$10$S.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6"
        },
        timeout: 10000
      });

      if (!res.data || !res.data.data || !Array.isArray(res.data.data)) {
        return { hits: [], total_hits: 0 };
      }

      const hits = res.data.data.map((mod: any) => {
        const latestFile = mod.latestFiles?.[0];
        const vn = this.cleanCurseForgeVersionName(
          latestFile?.displayName || latestFile?.fileName || "",
          mod.name
        );

        return {
          id: String(mod.id),
          slug: mod.slug,
          title: mod.name,
          description: mod.summary,
          icon_url: mod.logo?.url,
          author: mod.authors?.[0]?.name,
          downloads: mod.downloadCount,
          updated: mod.dateModified,
          categories: mod.categories?.map((c: any) => c.name),
          version_number: vn,
          game_versions:
            mod.latestFilesIndexes
              ?.map((f: any) => f.gameVersion)
              .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
              .slice(0, 3) || [],
          display_categories: mod.categories?.slice(0, 3).map((c: any) => c.name),
          source: "CurseForge",
          project_type: mod.classId === 12 ? "plugin" : "mod"
        };
      });

      return {
        hits,
        total_hits: res.data.pagination.totalCount
      };
    } catch (err) {
      console.error("CurseForge search error:", err);
      return { hits: [], total_hits: 0 };
    }
  }

  public async getProjectVersions(
    projectId: string,
    source: string = "Modrinth",
    loaders?: string[],
    gameVersions?: string[]
  ) {
    const s = source.toLowerCase();
    if (s === "curseforge") {
      return await this.getCurseForgeVersions(projectId);
    }
    if (s === "spigotmc") {
      return await this.getSpigotVersions(projectId);
    }
    try {
      const params: any = {};
      if (loaders) params.loaders = JSON.stringify(loaders);
      if (gameVersions) params.game_versions = JSON.stringify(gameVersions);

      const res = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/project/${projectId}/version`,
        params
      });

      const items = res.data || [];

      // Add project_type to each version so the frontend knows where to save it
      const projectRes = await this.requestWithRetry({
        method: "GET",
        url: `${this.baseUrl}/project/${projectId}`
      });
      const projectType = projectRes.data.project_type === "mod" ? "mod" : "plugin";

      return items.slice(0, 200).map((v: any) => ({
        ...v,
        project_type: projectType
      }));
    } catch (err) {
      return null;
    }
  }

  public async getCurseForgeVersions(projectId: string) {
    try {
      // Fetch mod info to get the name for cleaning version names
      let projectName = "";
      let modData: any = null;
      try {
        const modRes = await this.requestWithRetry({
          method: "GET",
          url: `${this.curseforgeUrl}/v1/cf/mods/${projectId}`,
          headers: {
            Accept: "application/json",
            "x-api-key": "$2a$10$S.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6"
          }
        });
        modData = modRes.data.data;
        projectName = modData.name;
      } catch (e) {}

      const res = await this.requestWithRetry({
        method: "GET",
        url: `${this.curseforgeUrl}/v1/cf/mods/${projectId}/files`,
        headers: {
          Accept: "application/json",
          "x-api-key": "$2a$10$S.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6"
        }
      });

      // Determine project type from categories or classId
      // classId 6 is Mod, 12 is Plugin
      const isPlugin =
        modData?.classId === 12 ||
        modData?.categories?.some((c: any) =>
          ["spigot", "paper", "purpur", "folia", "bungeecord", "velocity", "waterfall"].includes(
            c.name.toLowerCase()
          )
        );

      return res.data.data.map((file: any) => {
        const gameVersions = file.gameVersions || [];
        const loaders = gameVersions.filter((v: string) =>
          [
            "Forge",
            "Fabric",
            "Quilt",
            "NeoForge",
            "Bungeecord",
            "Spigot",
            "Paper",
            "Purpur"
          ].includes(v)
        );
        const realGameVersions = gameVersions.filter((v: string) => /^\d+\.\d+(\.\d+)?$/.test(v));

        const vn = this.cleanCurseForgeVersionName(
          file.displayName || file.fileName || "",
          projectName
        );

        return {
          id: String(file.id),
          name: vn,
          version_number: vn,
          game_versions: realGameVersions,
          loaders: loaders,
          project_type: isPlugin ? "plugin" : "mod",
          files: [
            {
              url: file.downloadUrl,
              filename: file.fileName,
              primary: true
            }
          ]
        };
      });
    } catch (err) {
      console.error("CurseForge versions error:", err);
      return null;
    }
  }

  public async searchSpigotMC(
    query: string,
    offset = 0,
    limit = 20,
    filters?: { version?: string; type?: string; loader?: string; environment?: string }
  ) {
    if (filters?.type === "mod") {
      return { hits: [], total_hits: 0 };
    }
    try {
      // Spiget API search endpoint returns 404 if no results are found
      // We should handle this gracefully
      const trimmedQuery = query?.trim() || " ";
      const url = `https://api.spiget.org/v2/search/resources/${encodeURIComponent(trimmedQuery)}`;

      const res = await this.requestWithRetry({
        method: "GET",
        url,
        params: {
          size: limit,
          page: Math.floor(offset / limit) + 1,
          fields: "id,name,tag,icon,rating,downloads,updateDate,version",
          sort: "-updateDate"
        },
        headers: {
          "User-Agent": "MCSManager"
        },
        validateStatus: (status: number) => (status >= 200 && status < 300) || status === 404
      });

      if (res.status === 404 || !res.data) {
        return { hits: [], total_hits: 0 };
      }

      const data = Array.isArray(res.data) ? res.data : [];

      // Fetch version names for all hits to avoid showing IDs
      const versionIds = data.map((item: any) => item.version?.id).filter((id: any) => !!id);
      const versionNamesMap: Record<string, string> = {};

      if (versionIds.length > 0) {
        try {
          // Spiget doesn't support batch version lookup easily, but we can try to get the latest version name
          // for each resource if it's not in the search result.
          // Actually, let's try to fetch the resource details which might have the version name.
          // Or just use the version ID as a fallback but try to find a better way.
          // For now, let's try to fetch the version name for each one in parallel (limited)
          await Promise.all(
            data.slice(0, 20).map(async (item: any) => {
              if (item.version?.id) {
                try {
                  const vRes = await this.requestWithRetry({
                    method: "GET",
                    url: `https://api.spiget.org/v2/resources/${item.id}/versions/${item.version.id}`,
                    timeout: 4000,
                    headers: {
                      "User-Agent": "MCSManager"
                    }
                  });
                  if (vRes.data?.name) {
                    versionNamesMap[item.version.id] = vRes.data.name;
                  }
                } catch (e) {}
              }
            })
          );
        } catch (e) {}
      }

      const hits = data.map((item: any) => ({
        id: String(item.id),
        slug: String(item.id),
        title: item.name,
        description: item.tag,
        icon_url: item.icon?.url ? `https://www.spigotmc.org/${item.icon.url}` : "",
        author: "",
        downloads: item.downloads,
        updated: new Date(item.updateDate * 1000).toISOString(),
        categories: [],
        version_number:
          versionNamesMap[item.version?.id] ||
          item.version?.name ||
          (item.version?.id ? String(item.version.id) : "Latest"),
        game_versions: [],
        display_categories: ["Spigot"],
        source: "SpigotMC",
        project_type: "plugin"
      }));

      return {
        hits,
        total_hits:
          parseInt(res.headers["x-total-count"] || "0") ||
          (data.length === limit ? offset + limit + 1 : offset + data.length)
      };
    } catch (err) {
      console.error("SpigotMC search error:", err);
      return { hits: [], total_hits: 0 };
    }
  }

  // ---- Modpack support (CurseForge server packs + Modrinth .mrpack) ----

  private readonly CF_KEY = "$2a$10$S.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6.v.m6";

  private parseCfGameVersions(gameVersions: string[]): { mc: string; loader: string } {
    const loaderNames: Record<string, string> = {
      forge: "forge",
      neoforge: "neoforge",
      fabric: "fabric",
      quilt: "quilt"
    };
    let mc = "";
    let loader = "vanilla";
    for (const v of gameVersions || []) {
      if (/^\d+\.\d+(\.\d+)?$/.test(v) && !mc) mc = v;
      const lk = loaderNames[String(v).toLowerCase()];
      if (lk) loader = lk;
    }
    return { mc, loader };
  }

  // Build a forgecdn fallback URL when the CF API omits downloadUrl.
  private cfFallbackUrl(fileId: number, fileName: string): string {
    // ForgeCDN requires the last segment zero-padded to 3 digits.
    const last3 = String(fileId % 1000).padStart(3, "0");
    return `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${last3}/${encodeURIComponent(
      fileName
    )}`;
  }

  // List installable versions of a CurseForge modpack, flagging server-pack availability.
  public async getCurseForgeModpackVersions(modId: string) {
    const res = await this.requestWithRetry({
      method: "GET",
      url: `${this.curseforgeUrl}/v1/cf/mods/${modId}/files`,
      headers: { Accept: "application/json", "x-api-key": this.CF_KEY }
    });
    const files = res.data?.data || [];
    return files.map((f: any) => {
      const { mc, loader } = this.parseCfGameVersions(f.gameVersions || []);
      return {
        fileId: String(f.id),
        displayName: f.displayName || f.fileName,
        fileName: f.fileName,
        mcVersion: mc,
        loader,
        hasServerPack: !!f.serverPackFileId,
        releaseType: f.releaseType, // 1 release, 2 beta, 3 alpha
        fileDate: f.fileDate
      };
    });
  }

  // Resolve the downloadable server-pack for a chosen CurseForge modpack file.
  // Returns null when the pack has no server pack.
  public async resolveCurseForgeServerPack(modId: string, fileId: string) {
    const fileRes = await this.requestWithRetry({
      method: "GET",
      url: `${this.curseforgeUrl}/v1/cf/mods/${modId}/files/${fileId}`,
      headers: { Accept: "application/json", "x-api-key": this.CF_KEY }
    });
    const file = fileRes.data?.data;
    const serverId = file?.serverPackFileId;
    if (!serverId) return null;

    const spRes = await this.requestWithRetry({
      method: "GET",
      url: `${this.curseforgeUrl}/v1/cf/mods/${modId}/files/${serverId}`,
      headers: { Accept: "application/json", "x-api-key": this.CF_KEY }
    });
    const sp = spRes.data?.data;
    if (!sp) return null;
    const { mc, loader } = this.parseCfGameVersions(sp.gameVersions || file.gameVersions || []);
    const url = sp.downloadUrl || this.cfFallbackUrl(Number(serverId), sp.fileName);
    return { serverPackUrl: url, fileName: sp.fileName, mcVersion: mc, loader };
  }

  // Strip HTML/markdown noise to readable plain text for the detail panel.
  private toPlainText(input: string): string {
    if (!input) return "";
    return input
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // markdown images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> text
      .replace(/<[^>]+>/g, " ") // html tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[#>*_`]+/g, "") // leftover markdown markers
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
      .slice(0, 8000);
  }

  // Full detail for a modpack project (for the install/detail dialog).
  public async getModpackDetail(source: string, projectId: string) {
    if (source.toLowerCase() === "ftb") {
      const p = await this.getFtbPack(Number(projectId));
      const art = Array.isArray(p?.art) ? p.art : [];
      const icon = art.find((a: any) => a.type === "square") || art[0];
      const gv = new Set<string>();
      for (const v of p?.versions || []) {
        for (const tg of v.targets || []) {
          if (tg.type === "game" || tg.name === "minecraft") gv.add(tg.version);
        }
      }
      const ts = Number(p?.updated || p?.released || 0);
      return {
        name: p?.name,
        summary: p?.synopsis,
        author: (p?.authors || [])[0]?.name,
        iconUrl: icon?.url,
        downloads: p?.installs,
        screenshots: art.filter((a: any) => a.type === "splash").map((a: any) => a.url),
        categories: (p?.tags || []).map((tg: any) => tg.name),
        gameVersions: Array.from(gv).slice(0, 8),
        updated: ts ? new Date(ts * 1000).toISOString() : undefined,
        websiteUrl: `https://www.feed-the-beast.com/modpacks/${projectId}`,
        description: this.toPlainText(p?.description || p?.synopsis || "")
      };
    }
    if (source.toLowerCase() === "curseforge") {
      const modRes = await this.requestWithRetry({
        method: "GET",
        url: `${this.curseforgeUrl}/v1/cf/mods/${projectId}`,
        headers: { Accept: "application/json", "x-api-key": this.CF_KEY }
      });
      const m = modRes.data?.data || {};
      let body = "";
      try {
        const d = await this.requestWithRetry({
          method: "GET",
          url: `${this.curseforgeUrl}/v1/cf/mods/${projectId}/description`,
          headers: { Accept: "application/json", "x-api-key": this.CF_KEY }
        });
        body = d.data?.data || "";
      } catch {}
      const versions = Array.from(
        new Set((m.latestFilesIndexes || []).map((f: any) => f.gameVersion))
      ).filter((v: any) => /^\d+\.\d+(\.\d+)?$/.test(v)) as string[];
      return {
        name: m.name,
        summary: m.summary,
        author: m.authors?.[0]?.name,
        iconUrl: m.logo?.url,
        downloads: m.downloadCount,
        screenshots: (m.screenshots || []).map((s: any) => s.url),
        categories: (m.categories || []).map((c: any) => c.name),
        gameVersions: versions.slice(0, 8),
        updated: m.dateModified,
        websiteUrl: m.links?.websiteUrl,
        description: this.toPlainText(body) || m.summary || ""
      };
    }

    // Modrinth
    const res = await this.requestWithRetry({
      method: "GET",
      url: `${this.baseUrl}/project/${projectId}`
    });
    const p = res.data || {};
    return {
      name: p.title,
      summary: p.description,
      author: undefined,
      iconUrl: p.icon_url,
      downloads: p.downloads,
      screenshots: (p.gallery || []).map((g: any) => g.url),
      categories: p.categories || [],
      gameVersions: (p.game_versions || []).slice(-8),
      updated: p.updated,
      websiteUrl: p.slug ? `https://modrinth.com/modpack/${p.slug}` : undefined,
      description: this.toPlainText(p.body || p.description || "")
    };
  }

  // Resolve the .mrpack download URL + metadata for a chosen Modrinth version.
  public async resolveModrinthVersion(versionId: string) {
    const res = await this.requestWithRetry({
      method: "GET",
      url: `${this.baseUrl}/version/${versionId}`
    });
    const v = res.data;
    if (!v) return null;
    const file = (v.files || []).find((f: any) => f.primary) || v.files?.[0];
    if (!file?.url) return null;
    return {
      mrpackUrl: file.url,
      mcVersion: v.game_versions?.[0] || "",
      loader: v.loaders?.[0] || "",
      versionName: v.version_number || v.name || ""
    };
  }

  public async getSpigotVersions(projectId: string) {
    try {
      let resourceName = projectId;
      try {
        const resourceRes = await this.requestWithRetry({
          method: "GET",
          url: `https://api.spiget.org/v2/resources/${projectId}`,
          headers: {
            "User-Agent": "MCSManager"
          }
        });
        resourceName = resourceRes.data.name;
      } catch (e) {}

      const res = await this.requestWithRetry({
        method: "GET",
        url: `https://api.spiget.org/v2/resources/${projectId}/versions`,
        params: { size: 100 },
        headers: {
          "User-Agent": "MCSManager"
        }
      });
      const versions = res.data;
      return versions.map((v: any, index: number) => {
        // Clean resource name for filename
        const safeName = resourceName.replace(/[\\\/\:\*\?\"\<\>\|]/g, "_").replace(/\s+/g, "_");
        // Use version-less download URL for the latest version to bypass SpigotMC Cloudflare via Spiget CDN
        // Spiget API returns versions sorted by releaseDate descending (newest first)
        const isLatest = index === 0;
        const downloadUrl = isLatest
          ? `https://api.spiget.org/v2/resources/${projectId}/download`
          : `https://api.spiget.org/v2/resources/${projectId}/versions/${v.id}/download`;

        // Use Spiget CDN to bypass Cloudflare if possible
        // If CDN fails (521), the daemon will still try the original URL with browser headers
        const cdnDownloadUrl = downloadUrl.replace("api.spiget.org", "cdn.spiget.org");

        return {
          id: String(v.id),
          name: v.name,
          version_number: v.name,
          game_versions: [],
          loaders: ["Spigot", "Paper"],
          project_type: "plugin",
          files: [
            {
              url: cdnDownloadUrl,
              filename: `${safeName}-${v.name}.jar`,
              primary: true
            },
            {
              url: downloadUrl,
              filename: `${safeName}-${v.name}.jar`,
              primary: false
            }
          ]
        };
      });
    } catch (err) {
      console.error("SpigotMC versions error:", err);
      return null;
    }
  }
}

export const modManagerService = new ModManagerService();

// Warm the modpack browser cache on panel startup, then keep it fresh so the
// CurseForge/Modrinth tabs load instantly instead of spinning on first open.
modManagerService.startModpackCacheWarmer();
