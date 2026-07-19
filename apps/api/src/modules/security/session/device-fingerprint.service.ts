import { Injectable, Logger, Optional } from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Components used to compute a device fingerprint on the server side.
 * The client may also send a pre-computed fingerprint (e.g. via
 * FingerprintJS); this DTO captures the raw signals for server-side
 * hashing when the client doesn't provide one.
 */
export interface DeviceFingerprintComponents {
  /** User-Agent header. */
  userAgent: string;
  /** Accept-Language header. */
  acceptLanguage?: string;
  /** Screen resolution (e.g. "1920x1080"). */
  screenResolution?: string;
  /** Timezone offset in minutes. */
  timezoneOffset?: number;
  /** Platform string (e.g. "Win32", "MacIntel"). */
  platform?: string;
  /** Number of CPU cores. */
  hardwareConcurrency?: number;
  /** Canvas fingerprint hash (client-computed). */
  canvasHash?: string;
  /** WebGL renderer string. */
  webglRenderer?: string;
}

/**
 * A trusted device record stored per user in Redis.
 */
export interface TrustedDeviceRecord {
  /** Unique device fingerprint hash. */
  fingerprint: string;
  /** Human-readable device name (derived from UA). */
  deviceName: string;
  /** When the device was first trusted (epoch ms). */
  trustedAt: number;
  /** Last activity from this device (epoch ms). */
  lastSeenAt: number;
  /** IP address when device was first trusted. */
  ip: string;
  /** User-Agent when device was trusted. */
  userAgent: string;
}

/** Redis key prefix for trusted devices per user. */
const TRUSTED_DEVICES_KEY = 'device:trusted:';
/** Redis key prefix for pending device verifications. */
const DEVICE_VERIFY_KEY = 'device:verify:';
/** Maximum trusted devices per user. */
const MAX_TRUSTED_DEVICES = 10;
/** TTL for device verification tokens (15 minutes). */
const DEVICE_VERIFY_TTL_SEC = 15 * 60;

/**
 * `DeviceFingerprintService` — Task 29.2 (Requirements 29.2, 29.9).
 *
 * Manages device fingerprinting and trusted device lists.
 *
 * Responsibilities:
 *   - Compute a server-side device fingerprint from request signals.
 *   - Maintain a per-user list of trusted devices in Redis.
 *   - Detect new (untrusted) devices at login time.
 *   - Issue device verification tokens for email-based confirmation.
 */
@Injectable()
export class DeviceFingerprintService {
  private readonly logger = new Logger(DeviceFingerprintService.name);

  constructor(@Optional() private readonly redis?: RedisService) {}

  // ─── Fingerprint Computation ───────────────────────────────────

  /**
   * Compute a device fingerprint hash from the given components.
   * Uses SHA-256 to produce a stable, non-reversible identifier.
   *
   * If the client provides a pre-computed fingerprint (e.g. from
   * FingerprintJS), prefer that over server-side computation.
   */
  computeFingerprint(components: DeviceFingerprintComponents): string {
    const crypto = require('crypto');
    const raw = [
      components.userAgent ?? '',
      components.acceptLanguage ?? '',
      components.screenResolution ?? '',
      String(components.timezoneOffset ?? ''),
      components.platform ?? '',
      String(components.hardwareConcurrency ?? ''),
      components.canvasHash ?? '',
      components.webglRenderer ?? '',
    ].join('|');

    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Derive a human-readable device name from the User-Agent string.
   * Example: "Chrome on Windows", "Safari on macOS", "Firefox on Linux".
   */
  deriveDeviceName(userAgent: string): string {
    if (!userAgent) return 'Unknown Device';

    let browser = 'Unknown Browser';
    let os = 'Unknown OS';

    // Detect browser
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browser = 'Chrome';
    } else if (userAgent.includes('Firefox')) {
      browser = 'Firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'Safari';
    } else if (userAgent.includes('Edg')) {
      browser = 'Edge';
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
      browser = 'Opera';
    }

    // Detect OS (order matters — check mobile before desktop)
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
      os = 'iOS';
    } else if (userAgent.includes('Android')) {
      os = 'Android';
    } else if (userAgent.includes('Windows')) {
      os = 'Windows';
    } else if (userAgent.includes('Mac OS') || userAgent.includes('Macintosh')) {
      os = 'macOS';
    } else if (userAgent.includes('Linux')) {
      os = 'Linux';
    }

    return `${browser} on ${os}`;
  }

  // ─── Trusted Device Management ────────────────────────────────

  /**
   * Check whether a device fingerprint is in the user's trusted list.
   */
  async isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
    if (!this.redis) return true; // fail-open when Redis unavailable
    const devices = await this.getTrustedDevices(userId);
    return devices.some((d) => d.fingerprint === fingerprint);
  }

  /**
   * Add a device to the user's trusted device list.
   * Enforces MAX_TRUSTED_DEVICES per user (FIFO eviction of oldest).
   */
  async addTrustedDevice(
    userId: string,
    device: {
      fingerprint: string;
      deviceName: string;
      ip: string;
      userAgent: string;
    },
  ): Promise<void> {
    if (!this.redis) return;

    const key = `${TRUSTED_DEVICES_KEY}${userId}`;
    let devices = await this.getTrustedDevices(userId);

    // Remove existing entry for same fingerprint (update scenario)
    devices = devices.filter((d) => d.fingerprint !== device.fingerprint);

    const now = Date.now();
    devices.push({
      fingerprint: device.fingerprint,
      deviceName: device.deviceName,
      ip: device.ip,
      userAgent: device.userAgent,
      trustedAt: now,
      lastSeenAt: now,
    });

    // Evict oldest if over limit
    if (devices.length > MAX_TRUSTED_DEVICES) {
      devices.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      devices = devices.slice(devices.length - MAX_TRUSTED_DEVICES);
    }

    await this.redis.set(key, JSON.stringify(devices));
    this.logger.debug(
      `Device trusted: user=${userId}, fingerprint=${device.fingerprint.slice(0, 8)}...`,
    );
  }

  /**
   * Remove a device from the user's trusted list.
   * Returns true if the device was found and removed.
   */
  async removeTrustedDevice(userId: string, fingerprint: string): Promise<boolean> {
    if (!this.redis) return false;

    const key = `${TRUSTED_DEVICES_KEY}${userId}`;
    const devices = await this.getTrustedDevices(userId);
    const filtered = devices.filter((d) => d.fingerprint !== fingerprint);

    if (filtered.length === devices.length) return false; // not found

    await this.redis.set(key, JSON.stringify(filtered));
    this.logger.debug(
      `Device removed: user=${userId}, fingerprint=${fingerprint.slice(0, 8)}...`,
    );
    return true;
  }

  /**
   * Get all trusted devices for a user.
   */
  async getTrustedDevices(userId: string): Promise<TrustedDeviceRecord[]> {
    if (!this.redis) return [];
    const key = `${TRUSTED_DEVICES_KEY}${userId}`;
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : [];
  }

  /**
   * Update the `lastSeenAt` timestamp for a trusted device.
   */
  async touchDevice(userId: string, fingerprint: string): Promise<void> {
    if (!this.redis) return;
    const key = `${TRUSTED_DEVICES_KEY}${userId}`;
    const devices = await this.getTrustedDevices(userId);
    const device = devices.find((d) => d.fingerprint === fingerprint);
    if (device) {
      device.lastSeenAt = Date.now();
      await this.redis.set(key, JSON.stringify(devices));
    }
  }

  /**
   * Remove all trusted devices for a user (e.g. on password change).
   */
  async clearAllTrustedDevices(userId: string): Promise<void> {
    if (!this.redis) return;
    const key = `${TRUSTED_DEVICES_KEY}${userId}`;
    await this.redis.del(key);
    this.logger.log(`All trusted devices cleared for user=${userId}`);
  }

  // ─── Device Verification (Req 29.9) ───────────────────────────

  /**
   * Create a device verification token. This is sent via email when
   * a login occurs from an unrecognized device.
   *
   * @returns The verification token to include in the confirmation link.
   */
  async createVerificationToken(
    userId: string,
    device: {
      fingerprint: string;
      deviceName: string;
      ip: string;
      userAgent: string;
    },
  ): Promise<string> {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    if (this.redis) {
      const verifyKey = `${DEVICE_VERIFY_KEY}${token}`;
      const payload = JSON.stringify({
        userId,
        fingerprint: device.fingerprint,
        deviceName: device.deviceName,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      await this.redis.set(verifyKey, payload, DEVICE_VERIFY_TTL_SEC);
    }

    this.logger.log(
      `Device verification token created: user=${userId}, device=${device.deviceName}`,
    );
    return token;
  }

  /**
   * Verify a device confirmation token. On success, adds the device
   * to the user's trusted list and removes the token.
   *
   * @returns The userId and fingerprint if valid, null otherwise.
   */
  async verifyDevice(
    token: string,
  ): Promise<{ userId: string; fingerprint: string } | null> {
    if (!this.redis) return null;

    const verifyKey = `${DEVICE_VERIFY_KEY}${token}`;
    const raw = await this.redis.get(verifyKey);
    if (!raw) return null;

    const { userId, fingerprint, deviceName, ip, userAgent } = JSON.parse(raw);

    // Add to trusted devices
    await this.addTrustedDevice(userId, {
      fingerprint,
      deviceName,
      ip,
      userAgent,
    });

    // Remove the verification token (one-time use)
    await this.redis.del(verifyKey);

    this.logger.log(
      `Device verified: user=${userId}, fingerprint=${fingerprint.slice(0, 8)}...`,
    );
    return { userId, fingerprint };
  }
}
