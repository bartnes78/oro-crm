const router = require('express').Router();

let _multer, _MsgReader;
function getMulter()    { if (!_multer)    _multer    = require('multer');                  return _multer; }
function getMsgReader() { if (!_MsgReader) _MsgReader = require('@kenjiuno/msgreader');     return _MsgReader; }

router.post('/api/email/parse-msg', (req, res, next) => {
  let multer;
  try { multer = getMulter(); } catch { return res.status(503).json({ error: 'Kjør npm install og restart' }); }
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')(req, res, next);
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil' });
  try {
    let MsgReader;
    try { MsgReader = getMsgReader(); } catch { return res.status(503).json({ error: 'Kjør npm install og restart' }); }
    const reader = new MsgReader.default(req.file.buffer);
    const data   = reader.getFileData();
    const msgClass   = (data.messageClass || '').toLowerCase();
    const isCalendar = msgClass.includes('appointment') || msgClass.includes('meeting') || msgClass.includes('schedule');
    let date = '';
    const rawDate = (isCalendar && data.apptStartWhole) ? data.apptStartWhole : data.messageDeliveryTime || data.clientSubmitTime || data.creationTime;
    if (rawDate) {
      let d = rawDate instanceof Date ? rawDate : typeof rawDate === 'string' ? new Date(rawDate) : typeof rawDate === 'number' ? new Date(rawDate / 10000 - 11644473600000) : null;
      if (d && !isNaN(d)) date = d.toISOString().slice(0, 10);
    }
    if (!date) date = new Date().toISOString().slice(0, 10);
    let body = data.body || '';
    if (!body && data.bodyHTML) {
      body = data.bodyHTML.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const senderEmail = (data.senderEmail || '').startsWith('/O=') ? '' : (data.senderEmail || '');
    const senderName  = data.senderName || '';
    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1].split('.')[0] : '';
    const recipients = (data.recipients || [])
      .map(r => ({ name: r.name || '', email: (r.email || r.smtpAddress || '').startsWith('/O=') ? '' : (r.email || r.smtpAddress || ''), recipType: r.recipType }))
      .filter(r => r.name || r.email);
    res.json({ from: senderEmail ? `${senderName} <${senderEmail}>` : senderName, senderName, senderEmail, senderDomain, recipients, subject: data.subject || '', date, body: body.slice(0, 3000), isCalendar, location: data.apptLocation || '' });
  } catch (e) {
    console.error('MSG parse error:', e);
    res.status(500).json({ error: 'Kunne ikke lese .msg-filen: ' + e.message });
  }
});

module.exports = router;
