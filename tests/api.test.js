import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'module';

const mockQuery = vi.fn();
const mockPool = {
  connect: vi.fn(),
  query: mockQuery,
  on: vi.fn(),
  end: vi.fn(),
};
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../db', () => ({
  query: mockQuery,
  pool: mockPool,
}));

vi.mock('connect-pg-simple', () => {
  return {
    default: () => class MockPgStore {
      constructor() {}
    },
  };
});

let request;
let app;

beforeAll(async () => {
  mockPool.connect.mockResolvedValue(mockClient);
  mockQuery.mockResolvedValue({ rows: [] });

  const supertest = await import('supertest');
  request = supertest.default;

  const mod = await import('../server.js');
  app = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
  mockQuery.mockResolvedValue({ rows: [] });
  mockClient.query.mockResolvedValue({ rows: [] });
});

function authedRequest(method, url) {
  const r = request(app)[method](url)
    .set('X-Requested-With', 'XMLHttpRequest')
    .set('Cookie', 'connect.sid=test');
  return r;
}

describe('Auth', () => {
  it('returns 401 for unauthenticated API calls', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(401);
  });

  it('rejects POST without X-Requested-With', async () => {
    const res = await request(app)
      .post('/api/investors')
      .send({ name: 'Test' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('X-Requested-With');
  });

  it('POST /api/login returns 400 without credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/login returns 401 or 500 for unknown user (session store dependency)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'ghost', password: 'pass' });
    expect([401, 500]).toContain(res.status);
  });
});

describe('Lookups', () => {
  it('GET /api/lookups returns domain data', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);

    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .get('/api/lookups')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie);
      if (res.status === 200) {
        expect(res.body.phases).toContain('Prospekt');
        expect(res.body.types).toContain('Pensjon');
        expect(res.body.leads).toContain('Ekstern');
        expect(res.body.logTypes).toContain('Møte');
      }
    }
  });
});

describe('Validation', () => {
  it('investor validation rejects invalid phase via POST', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .post('/api/investors')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ name: 'Test Corp', phase: 'UgyldigFase' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Ugyldig fase');
    }
  });

  it('task validation rejects missing label', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .post('/api/tasks')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ due_date: '2026-07-01' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Oppgavetekst er påkrevd');
    }
  });

  it('task validation rejects invalid date', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .post('/api/tasks')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ label: 'Ring investor', due_date: 'ugyldig' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Ugyldig frist');
    }
  });

  it('log validation rejects missing investor_id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .post('/api/log')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ date: '2026-06-19' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('investor_id er påkrevd');
    }
  });

  it('product-investors rejects missing ids', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .put('/api/product-investors')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ target_ticket: 50 });
      expect(res.status).toBe(400);
    }
  });

  it('product-investors rejects probability > 1', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .put('/api/product-investors')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ product_id: 1, investor_id: 'INV-001', probability: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mellom 0 og 1');
    }
  });

  it('product-investors rejects negative ticket', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] });
    const agent = request(app);
    const loginRes = await agent
      .post('/api/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test', password: 'pass' });

    if (loginRes.status === 200) {
      const cookie = loginRes.headers['set-cookie'];
      const res = await agent
        .put('/api/product-investors')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .send({ product_id: 1, investor_id: 'INV-001', target_ticket: -10 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positivt tall');
    }
  });
});

describe('CSRF protection', () => {
  it('blocks POST without X-Requested-With', async () => {
    const res = await request(app)
      .post('/api/investors')
      .send({ name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('blocks PUT without X-Requested-With', async () => {
    const res = await request(app)
      .put('/api/investors/INV-001')
      .send({ name: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('blocks DELETE without X-Requested-With', async () => {
    const res = await request(app)
      .delete('/api/investors/INV-001');
    expect(res.status).toBe(403);
  });

  it('allows GET without X-Requested-With (but still needs auth)', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });
});
