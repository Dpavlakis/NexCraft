import vanilla from "@/assets/loaders/vanilla.svg";
import bedrock from "@/assets/loaders/bedrock.svg";
import paper from "@/assets/loaders/paper.png";
import purpur from "@/assets/loaders/purpur.png";
import folia from "@/assets/loaders/folia.png";
import fabric from "@/assets/loaders/fabric.png";
import forge from "@/assets/loaders/forge.jpg";
import neoforge from "@/assets/loaders/neoforge.png";
import quilt from "@/assets/loaders/quilt.png";

// Loader/server-software logos used as a default instance icon when an instance
// has no server-icon.png of its own (e.g. a custom build). Keyed by the same
// loader values the builder stores in packInfo.loader.
const LOADER_ICONS: Record<string, string> = {
  vanilla,
  bedrock,
  paper,
  purpur,
  folia,
  fabric,
  forge,
  neoforge,
  quilt
};

/**
 * Returns the bundled loader logo for an instance's packInfo, or "" if there's
 * no sensible match. Bedrock instances use the Bedrock logo regardless of loader.
 */
export function loaderIconFor(packInfo?: { source?: string; loader?: string } | null): string {
  if (!packInfo) return "";
  if (packInfo.source === "bedrock") return bedrock;
  const key = (packInfo.loader || "").toLowerCase();
  return LOADER_ICONS[key] || "";
}
