import { useDefineApi } from "@/stores/useDefineApi";

export interface SecurityProof {
  currentPassword?: string;
  currentTOTP?: string;
}

export interface TwoFactorSetup {
  setupId: string;
  qrcode: string;
  expiresAt: number;
  replacing: boolean;
}

export type ConfirmTwoFactorRequest =
  | { enable: true; setupId: string; TOTPCode: string }
  | { enable: false; currentPassword?: string; currentTOTP: string };

export interface TwoFactorResult {
  enabled: boolean;
  reloginRequired: true;
}

// The force branch bypasses responseMap; it needs its own bounded timeout.
const securityRequest = { forceRequest: true, timeout: 15000 };

export const setUserApiKey = useDefineApi<{ data: SecurityProof & { enable: boolean } }, string>({
  url: "/api/auth/api",
  method: "PUT",
  ...securityRequest
});

export const updatePassword = useDefineApi<
  { data: { passWord: string; currentPassword: string; currentTOTP?: string; isInit?: boolean } },
  true
>({ url: "/api/auth/update", method: "PUT", ...securityRequest });

export const bind2FA = useDefineApi<{ data: SecurityProof }, TwoFactorSetup>({
  url: "/api/auth/bind2fa",
  method: "POST",
  ...securityRequest
});

export const confirm2FA = useDefineApi<{ data: ConfirmTwoFactorRequest }, TwoFactorResult>({
  url: "/api/auth/confirm2fa",
  method: "POST",
  ...securityRequest
});

export const cancel2FA = useDefineApi<{ data: { setupId: string } }, true>({
  url: "/api/auth/bind2fa",
  method: "DELETE",
  ...securityRequest
});

export const queryUsername = useDefineApi<
  {
    params: {
      username: string;
    };
  },
  {
    uuid?: string;
    userName?: string;
  }
>({
  url: "/api/auth/query_username",
  method: "GET"
});

export const updateMyAvatar = useDefineApi<
  {
    data: {
      avatar: string;
    };
  },
  boolean
>({
  url: "/api/auth/avatar",
  method: "PUT"
});

export const updateMyTheme = useDefineApi<
  {
    data: {
      theme: string;
    };
  },
  boolean
>({
  url: "/api/auth/theme",
  method: "PUT"
});
