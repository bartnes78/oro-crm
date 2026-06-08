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
  aktivitetslogg:      ()         => req('GET', '/aktivitetslogg'),
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
  cancelProduct:       (id, data) => req('POST',   `/products/${id}/cancel`, data),
  completeProduct:     (id)       => req('POST',   `/products/${id}/complete`),
  duplicates:          ()         => req('GET', '/duplicates'),
  duplicateContacts:   ()         => req('GET', '/duplicate-contacts'),
  mergeContacts:       (keep_id, drop_id) => req('POST', '/contacts/merge', { keep_id, drop_id }),
  declinedOffers:      (productId)        => req('GET', `/declined-offers?productId=${productId}`),
  addDeclinedOffer:    (data)             => req('POST', '/declined-offers', data),
  deleteDeclinedOffer: (id)               => req('DELETE', `/declined-offers/${id}`),
  backups:             ()                 => req('GET', '/backups'),
  restoreBackup:       (stamp)    => req('POST', `/backups/restore/${stamp}`),
  merge:               (keep_id, drop_id) => req('POST', '/merge', { keep_id, drop_id }),
  submitFeedback:      (data)     => req('POST', '/feedback', data),
  getFeedback:         ()         => req('GET', '/feedback'),
  getFeedbackScreenshot: (id)    => req('GET', `/feedback/${id}/screenshot`),
  auditLog:            (params)   => req('GET', '/audit-log?' + new URLSearchParams(params || {})),
  dataQuality:         ()         => req('GET', '/data-quality'),
  deletedInvestors:    ()         => req('GET', '/investors/trash'),
  restoreInvestor:     (id)       => req('POST', `/investors/${id}/restore`),
  brregSearch:         (q)        => req('GET', `/brreg/search?q=${encodeURIComponent(q)}`),
  brregEnhet:          (orgnr)    => req('GET', `/brreg/enhet/${orgnr}`),
  brregSync:           (id, data) => req('POST', `/investors/${id}/brreg-sync`, data),
  me:                  ()         => req('GET', '/me'),
  changeMyPassword:    (password) => req('PUT', '/me/password', { password }),
  users:               ()         => req('GET', '/users'),
  createUser:          (data)     => req('POST', '/users', data),
  updateUser:          (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser:          (id)       => req('DELETE', `/users/${id}`),
};
