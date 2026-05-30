// Session-lived cache of fetched modpack browse results so re-opening the
// Minecraft page shows the last list instantly while it refreshes in the
// background (stale-while-revalidate). Lives for the lifetime of the loaded SPA
// (survives navigating away and back); keyed by `source|sort|query|page`.
export interface BrowsePage {
  hits: any[];
  total: number;
}
export const modpackBrowseCache = new Map<string, BrowsePage>();
