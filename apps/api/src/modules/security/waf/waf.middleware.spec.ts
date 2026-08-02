import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  SecurityWafMiddleware,
  SecurityWafRequest,
  SecurityWafResponse,
} from './waf.middleware';
import { DEFAULT_WAF_RULES } from './waf-rules';
import { SiemService } from '../siem/siem.service';

describe('SecurityWafMiddleware', () => {
  let middleware: SecurityWafMiddleware;
  let config: jest.Mocked<ConfigService>;
  let siem: jest.Mocked<SiemService>;
  let req: Partial<SecurityWafRequest>;
  let res: Partial<SecurityWafResponse>;
  let next: jest.Mock;

  beforeEach(() => {
    config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'WAF_ENABLED') return true;
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      }),
    } as any;

    siem = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    } as any;

    middleware = new SecurityWafMiddleware(config, DEFAULT_WAF_RULES, siem);

    req = {
      method: 'GET',
      url: '/api/v1/resource',
      headers: {},
      query: {},
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      headersSent: false,
    };

    next = jest.fn();

    // Silence logger
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('allows a clean request through', () => {
    middleware.use(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  describe('BLOCK rules', () => {
    it('blocks SQL injection in URL (UNION SELECT)', () => {
      req.url = '/api/v1/resource?id=1%20union%20select%201,2,3';
      middleware.use(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'WAF_RULE_VIOLATION',
            ruleId: 'sql_injection.union_select',
          }),
        }),
      );
      expect(siem.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'security.waf.block' }),
      );
    });

    it('blocks XSS in Body (<script>)', () => {
      req.method = 'POST';
      req.body = { comment: '<script>alert(1)</script>' };
      middleware.use(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'WAF_RULE_VIOLATION',
            ruleId: 'xss.script_tag',
          }),
        }),
      );
    });

    it('blocks Path Traversal in Query (../../etc/passwd)', () => {
      req.query = { file: '../../etc/passwd' };
      middleware.use(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            ruleId: 'path_traversal.dotdot',
          }),
        }),
      );
    });

    it('blocks RCE in headers (; rm -rf)', () => {
      req.headers = { 'x-malicious-header': '; rm -rf /' };
      middleware.use(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('CHALLENGE and LOG rules', () => {
    it('applies a CHALLENGE marker but allows request (Scanner User-Agent)', () => {
      req.headers = { 'user-agent': 'sqlmap/1.4.11' };
      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.wafChallenge).toMatchObject({
        ruleId: 'suspicious.scanner_user_agent',
        category: 'SUSPICIOUS',
      });
      expect(siem.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'security.waf.detected' }),
      );
    });

    it('logs a detection but allows request (SQL comment marker)', () => {
      req.body = { text: 'Hello -- world' };
      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(siem.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security.waf.detected',
          payload: expect.objectContaining({
            ruleId: 'sql_injection.comment_marker',
          }),
        }),
      );
    });
  });

  describe('Skip and Disable logic', () => {
    it('skips WAF check if WAF_ENABLED is false', () => {
      config.get.mockImplementation((key) => {
        if (key === 'WAF_ENABLED') return false;
        return 'production';
      });
      req.url = '/?id=1%20union%20select%201';
      
      middleware.use(req as any, res as any, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('skips WAF check for /health path', () => {
      req.url = '/health?attack=<script>';
      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
