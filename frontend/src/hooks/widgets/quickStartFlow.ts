// Shared instance-creation enums. The legacy quick-start wizard that this file
// used to host was removed in #18; only these enums remain. They are imported by
// the modpack browser / Import flow (QUICKSTART_METHOD) and the command-assistant
// + start-command builder (QUICKSTART_ACTION_TYPE).

export enum QUICKSTART_ACTION_TYPE {
  Minecraft = "minecraft",
  Bedrock = "bedrock",
  Hytale = "hytale",
  Terraria = "terraria",
  SteamGameServer = "steam",
  Docker = "docker",
  AnyApp = "universal"
}

export enum QUICKSTART_METHOD {
  FAST = "FAST",
  FILE = "FILE",
  IMPORT = "IMPORT",
  SELECT = "SELECT",
  EXIST = "EXIST",
  DOCKER = "DOCKER"
}
