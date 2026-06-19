import { describe, it, expect } from 'vitest';
const {
  fmtRow, fmtInvestor, fmtUser,
  isValidDate, validateInvestorBody,
  hashPassword, verifyPassword,
  VALID_PHASES, VALID_TYPES, VALID_LEADS,
} = require('../lib/helpers');

describe('fmtRow', () => {
  it('renames id to _id', () => {
    const result = fmtRow({ id: 42, name: 'Test' });
    expect(result).toEqual({ _id: 42, name: 'Test' });
  });

  it('returns null for null input', () => {
    expect(fmtRow(null)).toBeNull();
  });
});

describe('fmtInvestor', () => {
  it('returns null for null input', () => {
    expect(fmtInvestor(null)).toBeNull();
  });

  it('maps investor fields with defaults', () => {
    const result = fmtInvestor({ id: 'INV-001', name: 'Test AS', phase: 'Prospekt' });
    expect(result.id).toBe('INV-001');
    expect(result.name).toBe('Test AS');
    expect(result.product_interests).toEqual([]);
    expect(result.declined_offers).toEqual([]);
    expect(result.committed_total).toBe(0);
    expect(result.weighted_total).toBe(0);
    expect(result.docs).toEqual({});
    expect(result.brreg_data).toEqual({});
  });

  it('preserves existing product_interests', () => {
    const result = fmtInvestor({ id: 'INV-001', name: 'X', product_interests: [1, 2] });
    expect(result.product_interests).toEqual([1, 2]);
  });
});

describe('fmtUser', () => {
  it('returns null for null input', () => {
    expect(fmtUser(null)).toBeNull();
  });

  it('maps user fields correctly', () => {
    const result = fmtUser({ id: 1, username: 'admin', display_name: 'Admin', role: 'admin', must_change_password: false, lead_name: 'Kristian Bartnes' });
    expect(result).toEqual({
      _id: 1, username: 'admin', displayName: 'Admin', role: 'admin', mustChangePassword: false, leadName: 'Kristian Bartnes',
    });
  });

  it('converts must_change_password to boolean', () => {
    const result = fmtUser({ id: 1, username: 'u', display_name: 'U', role: 'bruker', must_change_password: 1 });
    expect(result.mustChangePassword).toBe(true);
  });
});

describe('isValidDate', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(isValidDate('2026-06-19')).toBe(true);
    expect(isValidDate('2025-01-01')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidDate('19.06.2026')).toBe(false);
    expect(isValidDate('2026/06/19')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
    expect(isValidDate(12345)).toBe(false);
  });

  it('rejects invalid dates in correct format', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-01')).toBe(false);
  });
});

describe('validateInvestorBody', () => {
  it('requires name when requireName is true', () => {
    const errors = validateInvestorBody({}, true);
    expect(errors).toContain('Navn er påkrevd');
  });

  it('does not require name when requireName is false', () => {
    const errors = validateInvestorBody({}, false);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid phase', () => {
    const errors = validateInvestorBody({ name: 'Test', phase: 'Ugyldig' }, true);
    expect(errors.some(e => e.includes('Ugyldig fase'))).toBe(true);
  });

  it('accepts valid phases', () => {
    for (const phase of VALID_PHASES) {
      const errors = validateInvestorBody({ name: 'Test', phase }, true);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects invalid investor_type', () => {
    const errors = validateInvestorBody({ name: 'Test', investor_type: 'Feil' }, true);
    expect(errors.some(e => e.includes('Ugyldig type'))).toBe(true);
  });

  it('rejects invalid lead', () => {
    const errors = validateInvestorBody({ name: 'Test', lead: 'Ukjent Person' }, true);
    expect(errors.some(e => e.includes('Ugyldig lead'))).toBe(true);
  });

  it('rejects non-array product_interests', () => {
    const errors = validateInvestorBody({ name: 'Test', product_interests: 'not-array' }, true);
    expect(errors.some(e => e.includes('product_interests'))).toBe(true);
  });

  it('accepts valid complete body', () => {
    const errors = validateInvestorBody({
      name: 'Valid Corp AS',
      phase: 'Aktiv dialog',
      investor_type: 'Pensjon',
      lead: 'Kristian Bartnes',
      fund_vehicle: 'IS',
      product_interests: [1, 2],
    }, true);
    expect(errors).toHaveLength(0);
  });
});

describe('password hashing', () => {
  it('hashes and verifies correctly', () => {
    const hash = hashPassword('testpassord123');
    expect(hash).toContain(':');
    expect(verifyPassword('testpassord123', hash)).toBe(true);
  });

  it('rejects wrong password', () => {
    const hash = hashPassword('riktig');
    expect(verifyPassword('feil', hash)).toBe(false);
  });

  it('produces different hashes for same password (unique salt)', () => {
    const h1 = hashPassword('same');
    const h2 = hashPassword('same');
    expect(h1).not.toBe(h2);
    expect(verifyPassword('same', h1)).toBe(true);
    expect(verifyPassword('same', h2)).toBe(true);
  });
});

describe('domain constants', () => {
  it('has 5 valid phases', () => {
    expect(VALID_PHASES).toHaveLength(5);
    expect(VALID_PHASES).toContain('Prospekt');
    expect(VALID_PHASES).toContain('Investor');
  });

  it('has valid investor types', () => {
    expect(VALID_TYPES).toContain('Pensjon');
    expect(VALID_TYPES).toContain('Family Office');
    expect(VALID_TYPES).toContain('Annet');
  });

  it('has valid leads including Ekstern', () => {
    expect(VALID_LEADS).toContain('Ekstern');
    expect(VALID_LEADS).toContain('Kristian Bartnes');
  });
});
