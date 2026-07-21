import { RedisService } from './redis.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    publish: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  }));
});

describe('RedisService', () => {
  let service: RedisService;
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    };

    service = new RedisService(mockConfigService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should read REDIS_URL from ConfigService', () => {
    expect(mockConfigService.get).toHaveBeenCalledWith('REDIS_URL', {
      infer: true,
    });
  });

  it('should return the underlying ioredis client', () => {
    const client = service.getClient();
    expect(client).toBeDefined();
  });

  it('should call get on the client', async () => {
    const client = service.getClient();
    (client.get as jest.Mock).mockResolvedValue('value');

    const result = await service.get('key');
    expect(result).toBe('value');
    expect(client.get).toHaveBeenCalledWith('key');
  });

  it('should call set with TTL when provided', async () => {
    const client = service.getClient();
    (client.set as jest.Mock).mockResolvedValue('OK');

    await service.set('key', 'value', 60);
    expect(client.set).toHaveBeenCalledWith('key', 'value', 'EX', 60);
  });

  it('should call set without TTL when not provided', async () => {
    const client = service.getClient();
    (client.set as jest.Mock).mockResolvedValue('OK');

    await service.set('key', 'value');
    expect(client.set).toHaveBeenCalledWith('key', 'value');
  });

  it('should call setnx and return true on success', async () => {
    const client = service.getClient();
    (client.set as jest.Mock).mockResolvedValue('OK');

    const result = await service.setnx('lock-key', '1', 30);
    expect(result).toBe(true);
    expect(client.set).toHaveBeenCalledWith('lock-key', '1', 'EX', 30, 'NX');
  });

  it('should call setnx and return false when key exists', async () => {
    const client = service.getClient();
    (client.set as jest.Mock).mockResolvedValue(null);

    const result = await service.setnx('lock-key', '1', 30);
    expect(result).toBe(false);
  });

  it('should check if key exists', async () => {
    const client = service.getClient();
    (client.exists as jest.Mock).mockResolvedValue(1);

    const result = await service.exists('key');
    expect(result).toBe(true);
  });

  it('should return false when key does not exist', async () => {
    const client = service.getClient();
    (client.exists as jest.Mock).mockResolvedValue(0);

    const result = await service.exists('key');
    expect(result).toBe(false);
  });
});
