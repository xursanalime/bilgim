export { ThreatProtectionModule } from './threat-protection.module';
export {
  ThreatProtectionService,
  THREAT_PROTECTION_CONSTANTS,
  type WafBlockEntry,
  type WafBlockReason,
  type WafDetection,
  type WafSignature,
  type InspectableRequest,
} from './threat-protection.service';
export {
  ThreatProtectionGuard,
  WAF_AUDIT_ACTIONS,
} from './threat-protection.guard';
export {
  ThreatProtectionController,
  ListBlockedIpsQuerySchema,
  UnblockIpBodySchema,
  type ListBlockedIpsQueryDto,
  type UnblockIpBodyDto,
} from './threat-protection.controller';
