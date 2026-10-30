import { createHash } from "crypto";
import { User } from "../entity/user";
export function credentialFingerprint(user: User): string {
  return createHash("sha256")
    .update(
      JSON.stringify([user.uuid, user.passWordType, user.passWord, user.open2FA, user.secret])
    )
    .digest("hex");
}
