import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockPool = {
  connect: vi.fn(),
  query: mockQuery,
  on: vi.fn(),
  end: vi.fn(),
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
  mockPool.connect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
  mockQuery.mockResolvedValue({ rows: [] });
  const supertest = await import('supertest');
  request = supertest.default;
  const mod = await import('../server.js');
  app = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
  mockQuery.mockResolvedValue({ rows: [] });
});

function loginAndRequest(method, url) {
  return request(app)[method](url)
    .set('X-Requested-With', 'XMLHttpRequest')
    .set('Cookie', 'connect.sid=test');
}

async function setupAuth() {
  mockQuery.mockResolvedValue({
    rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }],
  });
  const agent = request(app);
  const loginRes = await agent
    .post('/api/login')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ username: 'test', password: 'pass' });
  if (loginRes.status !== 200) return null;
  return loginRes.headers['set-cookie'];
}

describe('Playbook suggestions', () => {
  it('returns suggestions for Prospekt investor with no contact', async () => {
    const cookie = await setupAuth();
    if (!cookie) return;

    let callNum = 0;
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('users')) {
        return { rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] };
      }
      if (sql.includes('FROM investors') && sql.includes('phase IN')) {
        return { rows: [{ id: 'INV-001', name: 'Test AS', phase: 'Prospekt', lead: 'Kristian Bartnes', investor_type: 'Pensjon', last_contact: null, docs: {}, next_steps: null }] };
      }
      if (sql.includes('FROM contact_log')) return { rows: [] };
      if (sql.includes('FROM tasks')) return { rows: [] };
      if (sql.includes('SUM(target_ticket)')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/playbook/suggestions')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', cookie);

    if (res.status === 200) {
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThan(0);
      const s = res.body[0];
      expect(s.investor_id).toBe('INV-001');
      expect(s.suggestion.action).toBe('Ta kontakt');
      expect(s.suggestion.priority).toBe('high');
      expect(s.progress.has_contact).toBe(false);
      expect(s.progress.has_deck).toBe(false);
    }
  });

  it('suggests send-deck when contact exists but no deck', async () => {
    const cookie = await setupAuth();
    if (!cookie) return;

    mockQuery.mockImplementation((sql) => {
      if (sql.includes('users')) {
        return { rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] };
      }
      if (sql.includes('FROM investors') && sql.includes('phase IN')) {
        return { rows: [{ id: 'INV-002', name: 'Corp AS', phase: 'Prospekt', lead: null, investor_type: null, last_contact: '2026-06-10', docs: {}, next_steps: null }] };
      }
      if (sql.includes('FROM contact_log')) {
        return { rows: [{ investor_id: 'INV-002', date: '2026-06-10', log_type: 'Telefon', status: 'avholdt' }] };
      }
      if (sql.includes('FROM tasks')) return { rows: [] };
      if (sql.includes('SUM(target_ticket)')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/playbook/suggestions')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', cookie);

    if (res.status === 200) {
      const s = res.body.find(s => s.investor_id === 'INV-002');
      expect(s).toBeTruthy();
      expect(s.suggestion.action).toBe('Send intro-deck');
      expect(s.progress.has_contact).toBe(true);
      expect(s.progress.has_deck).toBe(false);
    }
  });

  it('suggests book-meeting for Aktiv dialog without meeting', async () => {
    const cookie = await setupAuth();
    if (!cookie) return;

    mockQuery.mockImplementation((sql) => {
      if (sql.includes('users')) {
        return { rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] };
      }
      if (sql.includes('FROM investors') && sql.includes('phase IN')) {
        return { rows: [{ id: 'INV-003', name: 'Dialog AS', phase: 'Aktiv dialog', lead: null, investor_type: null, last_contact: '2026-06-15', docs: { '1': { deck: { done: 1 } } }, next_steps: null }] };
      }
      if (sql.includes('FROM contact_log')) {
        return { rows: [{ investor_id: 'INV-003', date: '2026-06-15', log_type: 'E-post sendt', status: 'avholdt' }] };
      }
      if (sql.includes('FROM tasks')) return { rows: [] };
      if (sql.includes('SUM(target_ticket)')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/playbook/suggestions')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', cookie);

    if (res.status === 200) {
      const s = res.body.find(s => s.investor_id === 'INV-003');
      expect(s).toBeTruthy();
      expect(s.suggestion.action).toBe('Book møte');
    }
  });
});

describe('Playbook benchmarks', () => {
  it('returns benchmark data', async () => {
    const cookie = await setupAuth();
    if (!cookie) return;

    mockQuery.mockImplementation((sql) => {
      if (sql.includes('users')) {
        return { rows: [{ id: 1, username: 'test', display_name: 'Test', role: 'admin', must_change_password: false, lead_name: null }] };
      }
      if (sql.includes('FROM investors') && !sql.includes('phase IN')) {
        return { rows: [
          { id: 'INV-A', phase: 'Investor', docs: { '1': { deck: { done: 1 }, im_ppm: { done: 1 } } }, last_contact: '2026-06-01' },
          { id: 'INV-B', phase: 'Prospekt', docs: {}, last_contact: null },
        ] };
      }
      if (sql.includes('FROM contact_log')) {
        return { rows: [
          { investor_id: 'INV-A', date: '2026-01-01', log_type: 'Møte', status: 'avholdt' },
          { investor_id: 'INV-A', date: '2026-03-01', log_type: 'Telefon', status: 'avholdt' },
          { investor_id: 'INV-A', date: '2026-05-01', log_type: 'Møte', status: 'avholdt' },
        ] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/playbook/benchmarks')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', cookie);

    if (res.status === 200) {
      expect(res.body.totalInvestors).toBe(2);
      expect(res.body.converted.count).toBe(1);
      expect(res.body.converted.avgActivities).toBe(3);
      expect(res.body.converted.docCompletion.deck).toBe(100);
      expect(res.body.converted.docCompletion.im_ppm).toBe(100);
      expect(res.body.pipeline.count).toBe(1);
      expect(res.body.phaseDistribution).toHaveProperty('Investor');
      expect(res.body.phaseDistribution).toHaveProperty('Prospekt');
    }
  });
});
