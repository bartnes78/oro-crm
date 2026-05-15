const BASE = '/api';

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg;
    try { msg = JSON.parse(text).error; } catch { msg = text; }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  dashboard:           ()         => req('GET', '/dashboard'),
  analyse:             ()         => req('GET', '/analyse'),
  investors:           (params)   => req('GET', '/investors?' + new URLSearchParams(params || {})),
  investor:            (id)       => req('GET', `/investors/${id}`),
  createInvestor:      (data)     => req('POST', '/investors', data),
  updateInvestor:      (id, data) => req('PUT', `/investors/${id}`, data),
  deleteInvestor:      (id)       => req('DELETE', `/investors/${id}`),
  contacts:            (invId)    => req('GET', invId ? `/contacts?investorId=${invId}` : '/contacts'),
  addContact:          (data)     => req('POST', '/contacts', data),
  updateContact:       (id, data) => req('PUT', `/contacts/${id}`, data),
  deleteContact:       (id)       => req('DELETE', `/contacts/${id}`),
  log:                 (invId, limit) => req('GET', `/log?${invId ? `investorId=${invId}&` : ''}${limit ? `limit=${limit}` : ''}`),
  addLog:              (data)     => req('POST',   '/log', data),
  updateLog:           (id, data) => req('PUT',    `/log/${id}`, data),
  deleteLog:           (id)       => req('DELETE', `/log/${id}`),
  tasks:               (params)   => req('GET', '/tasks?' + new URLSearchParams(params || {})),
  addTask:             (data)     => req('POST',   '/tasks', data),
  updateTask:          (id, data) => req('PUT',    `/tasks/${id}`, data),
  deleteTask:          (id)       => req('DELETE', `/tasks/${id}`),
  lookups:             ()         => req('GET', '/lookups'),
  locations:           ()         => req('GET', '/locations'),
  productInvestors:      (investorId) => req('GET', `/product-investors?investorId=${investorId}`),
  updateProductInvestor: (productId, investorId, data) =>
    req('PUT', '/product-investors', { product_id: productId, investor_id: investorId, ...data }),
  products:            ()         => req('GET', '/products'),
  addProduct:          (data)     => req('POST',   '/products', data),
  updateProduct:       (id, data) => req('PUT',    `/products/${id}`, data),
  deleteProduct:       (id)       => req('DELETE', `/products/${id}`),
  duplicates:          ()         => req('GET', '/duplicates'),
  duplicateContacts:   ()         => req('GET', '/duplicate-contacts'),
  mergeContacts:       (keep_id, drop_id) => req('POST', '/contacts/merge', { keep_id, drop_id }),
  backups:             ()         => req('GET', '/backups'),
  restoreBackup:       (stamp)    => req('POST', `/backups/restore/${stamp}`),
  merge:               (keep_id, drop_id) => req('POST', '/merge', { keep_id, drop_id }),
  me:                  ()         => req('GET', '/me'),
  users:               ()         => req('GET', '/users'),
  createUser:          (data)     => req('POST', '/users', data),
  updateUser:          (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser:          (id)       => req('DELETE', `/users/${id}`),
};
