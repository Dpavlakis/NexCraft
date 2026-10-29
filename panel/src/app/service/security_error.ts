export class SecurityError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
// File writes can identify definite pre-commit failure. Unknown remote outcomes fail closed.
export class UserWriteError extends Error {
  constructor(public readonly definite: boolean) {
    super("User persistence unavailable");
  }
}

export class SessionError extends SecurityError {}
