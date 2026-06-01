// Per-loader description (i18n key) + official link + curated tags/features for the
// custom builder's Details tab.
export const LOADER_INFO: Record<
  string,
  { blurbKey: string; url: string; categoryKeys: string[]; featureKeys: string[] }
> = {
  vanilla: {
    blurbKey: "TXT_CODE_loader_blurb_vanilla",
    url: "https://www.minecraft.net/",
    categoryKeys: ["TXT_CODE_loader_cat_vanilla", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_vanilla_1","TXT_CODE_loader_feat_vanilla_2","TXT_CODE_loader_feat_vanilla_3","TXT_CODE_loader_feat_vanilla_4"]
  },
  paper: {
    blurbKey: "TXT_CODE_loader_blurb_paper",
    url: "https://papermc.io/software/paper",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_paper_1","TXT_CODE_loader_feat_paper_2","TXT_CODE_loader_feat_paper_3","TXT_CODE_loader_feat_paper_4"]
  },
  purpur: {
    blurbKey: "TXT_CODE_loader_blurb_purpur",
    url: "https://purpurmc.org/",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_purpur_1","TXT_CODE_loader_feat_purpur_2","TXT_CODE_loader_feat_purpur_3","TXT_CODE_loader_feat_purpur_4"]
  },
  folia: {
    blurbKey: "TXT_CODE_loader_blurb_folia",
    url: "https://papermc.io/software/folia",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_folia_1","TXT_CODE_loader_feat_folia_2","TXT_CODE_loader_feat_folia_3","TXT_CODE_loader_feat_folia_4"]
  },
  fabric: {
    blurbKey: "TXT_CODE_loader_blurb_fabric",
    url: "https://fabricmc.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_fabric_1","TXT_CODE_loader_feat_fabric_2","TXT_CODE_loader_feat_fabric_3","TXT_CODE_loader_feat_fabric_4"]
  },
  forge: {
    blurbKey: "TXT_CODE_loader_blurb_forge",
    url: "https://forums.minecraftforge.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_forge_1","TXT_CODE_loader_feat_forge_2","TXT_CODE_loader_feat_forge_3","TXT_CODE_loader_feat_forge_4"]
  },
  neoforge: {
    blurbKey: "TXT_CODE_loader_blurb_neoforge",
    url: "https://neoforged.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_neoforge_1","TXT_CODE_loader_feat_neoforge_2","TXT_CODE_loader_feat_neoforge_3","TXT_CODE_loader_feat_neoforge_4"]
  },
  quilt: {
    blurbKey: "TXT_CODE_loader_blurb_quilt",
    url: "https://quiltmc.org/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: ["TXT_CODE_loader_feat_quilt_1","TXT_CODE_loader_feat_quilt_2","TXT_CODE_loader_feat_quilt_3","TXT_CODE_loader_feat_quilt_4"]
  },
  bedrock: {
    blurbKey: "TXT_CODE_loader_blurb_bedrock",
    url: "https://www.minecraft.net/download/server/bedrock",
    categoryKeys: ["TXT_CODE_loader_cat_bedrock"],
    featureKeys: ["TXT_CODE_loader_feat_bedrock_1","TXT_CODE_loader_feat_bedrock_2","TXT_CODE_loader_feat_bedrock_3","TXT_CODE_loader_feat_bedrock_4"]
  }
};
