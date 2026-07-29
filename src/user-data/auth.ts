import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { UserSession } from "./models.ts";

type SessionTokenPayload = Readonly<{
  version: 1;
  userId: string;
  expiresAt: number;
}>;

export type IssuedSession = Readonly<{
  token: string;
  session: UserSession;
}>;

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class SignedSessionService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(
    secret: string,
    options: Readonly<{
      ttlSeconds?: number;
      now?: () => number;
    }> = {},
  ) {
    if (secret.length < 32) {
      throw new RangeError("SESSION_SECRET_TOO_SHORT");
    }
    const ttlSeconds = options.ttlSeconds ?? 30 * 24 * 60 * 60;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60) {
      throw new RangeError("SESSION_TTL_INVALID");
    }
    this.secret = secret;
    this.ttlSeconds = ttlSeconds;
    this.now = options.now ?? (() => Date.now());
  }

  private signature(encodedPayload: string): Buffer {
    return createHmac("sha256", this.secret)
      .update(encodedPayload)
      .digest();
  }

  issue(): IssuedSession {
    const session: UserSession = {
      userId: randomUUID(),
      expiresAt: this.now() + this.ttlSeconds * 1_000,
    };
    const payload: SessionTokenPayload = {
      version: 1,
      ...session,
    };
    const encodedPayload = encode(JSON.stringify(payload));
    const signature = this.signature(encodedPayload).toString(
      "base64url",
    );
    return {
      token: `zhaolu.v1.${encodedPayload}.${signature}`,
      session,
    };
  }

  verify(token: string): UserSession | null {
    const parts = token.split(".");
    if (
      parts.length !== 4 ||
      parts[0] !== "zhaolu" ||
      parts[1] !== "v1"
    ) {
      return null;
    }
    let suppliedSignature: Buffer;
    let payload: unknown;
    try {
      suppliedSignature = Buffer.from(parts[3], "base64url");
      payload = JSON.parse(decode(parts[2])) as unknown;
    } catch {
      return null;
    }
    const expectedSignature = this.signature(parts[2]);
    if (
      suppliedSignature.byteLength !== expectedSignature.byteLength ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return null;
    }
    const value = payload as Record<string, unknown>;
    if (
      value.version !== 1 ||
      typeof value.userId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(value.userId) ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= this.now()
    ) {
      return null;
    }
    return {
      userId: value.userId,
      expiresAt: value.expiresAt,
    };
  }
}
