export { AuthModule } from './auth.module';
export { AuthService } from './auth.service';
export { AuthHardeningService } from './auth-hardening.service';
export type {
  AuthHardeningFailureResult,
  AccountLockCode,
  IpLockCode,
  UnlockResult,
} from './auth-hardening.service';
export { BruteForceProtectionService } from './brute-force-protection.service';
export type {
  BruteForceTier,
  BruteForceFailureResult,
  CredentialStuffingResult,
} from './brute-force-protection.service';
export { TokensService } from './tokens.service';
export { UsersRepository } from './repositories/users.repository';
export { RegisterSchema, type RegisterDto } from './dto';
export { LoginSchema, type LoginDto } from './dto';
export { VerifyEmailSchema, type VerifyEmailDto } from './dto';
export {
  ResendVerificationSchema,
  type ResendVerificationDto,
} from './dto';
export {
  AccountUnlockSchema,
  type AccountUnlockDto,
} from './dto';
