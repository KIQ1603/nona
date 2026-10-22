import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id minimum (19 MiB, t=2, p=1).
const OPTIONS = {
  algorithm: 2 /* Argon2id */,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher {
  private dummy?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password).catch(() => false);
  }

  /** Burns equivalent CPU for unknown accounts so response time does not reveal which emails exist. */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= this.hash('nona-timing-equalizer');
    await this.verify(await this.dummy, password);
  }
}
