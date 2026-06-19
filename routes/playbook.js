const express = require('express');
const { query } = require('../db');

const router = express.Router();

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function buildContext(inv, logs, tasks) {
  const completed = logs.filter(l => l.status !== 'planlagt');
  const planned   = logs.filter(l => l.status === 'planlagt');
  const todayStr  = new Date().toISOString().slice(0, 10);

  const docs = inv.docs || {};
  let hasDeck = false, hasImPpm = false, hasFondsvilkar = false, hasNda = false;
  for (const pd of Object.values(docs)) {
    if (pd.deck?.done)        hasDeck = true;
    if (pd.im_ppm?.done)      hasImPpm = true;
    if (pd.fondsvilkar?.done) hasFondsvilkar = true;
    if (pd.nda?.done)         hasNda = true;
  }

  const hasMeeting    = completed.some(l => l.log_type === 'Møte' || l.log_type === 'Video');
  const openTasks     = tasks.filter(t => !t.done);
  const overdueTasks  = openTasks.filter(t => t.due_date && t.due_date < todayStr);

  return {
    logCount:          completed.length,
    plannedCount:      planned.length,
    hasPlanned:        planned.length > 0,
    daysSinceContact:  daysSince(inv.last_contact),
    hasDeck,
    hasImPpm,
    hasFondsvilkar,
    hasNda,
    hasMeeting,
    meetingCount:      completed.filter(l => l.log_type === 'Møte' || l.log_type === 'Video').length,
    openTaskCount:     openTasks.length,
    overdueTaskCount:  overdueTasks.length,
  };
}

// First matching rule wins per investor
const RULES = {
  'Prospekt': [
    {
      id: 'first-contact',
      check: ctx => ctx.logCount === 0,
      action: 'Ta kontakt',
      detail: 'Ring eller send intro-epost',
      priority: 'high',
    },
    {
      id: 'send-deck',
      check: ctx => ctx.logCount > 0 && !ctx.hasDeck,
      action: 'Send intro-deck',
      detail: 'Kontakt opprettet — del presentasjon',
      priority: 'high',
    },
    {
      id: 'book-meeting',
      check: ctx => ctx.hasDeck && !ctx.hasMeeting,
      action: 'Book møte',
      detail: 'Deck sendt — avtal møte',
      priority: 'high',
    },
    {
      id: 'followup-meeting',
      check: ctx => ctx.hasMeeting && ctx.daysSinceContact >= 14 && !ctx.hasPlanned,
      action: 'Følg opp etter møte',
      detail: 'Ring for tilbakemelding',
      priority: 'medium',
    },
  ],
  'Aktiv dialog': [
    {
      id: 'stale-dialog',
      check: ctx => ctx.daysSinceContact >= 21 && !ctx.hasPlanned,
      action: 'Planlegg kontakt',
      detail: 'Over 3 uker uten kontakt — oppretthold momentum',
      priority: 'high',
    },
    {
      id: 'no-meeting',
      check: ctx => !ctx.hasMeeting,
      action: 'Book møte',
      detail: 'Ingen møte registrert — avtal møte',
      priority: 'high',
    },
    {
      id: 'send-imppm',
      check: ctx => ctx.hasMeeting && !ctx.hasImPpm,
      action: 'Send IM/PPM',
      detail: 'Møte avholdt — send investeringsmemorandum',
      priority: 'high',
    },
    {
      id: 'send-fondsvilkar',
      check: ctx => ctx.hasImPpm && !ctx.hasFondsvilkar,
      action: 'Send fondsvilkår',
      detail: 'IM/PPM delt — send fondsvilkår',
      priority: 'medium',
    },
    {
      id: 'followup-call',
      check: ctx => ctx.hasImPpm && ctx.daysSinceContact >= 14 && !ctx.hasPlanned,
      action: 'Ring for oppfølging',
      detail: 'Følg opp IM/PPM med telefon',
      priority: 'medium',
    },
  ],
  'Investor': [
    {
      id: 'checkin-60',
      check: ctx => ctx.daysSinceContact >= 60 && !ctx.hasPlanned,
      action: 'Planlegg oppfølging',
      detail: 'Over 60 dager siden sist kontakt',
      priority: 'medium',
    },
    {
      id: 'no-planned',
      check: ctx => !ctx.hasPlanned && ctx.daysSinceContact >= 30,
      action: 'Sett opp neste møte',
      detail: 'Ingen planlagt aktivitet',
      priority: 'low',
    },
  ],
  'Tidligere investor': [],
  'På vent': [
    {
      id: 'overdue-task',
      check: ctx => ctx.overdueTaskCount > 0,
      action: 'Forfalt oppgave',
      detail: 'Oppgave har passert frist — vurder å ta kontakt',
      priority: 'high',
    },
    {
      id: 'no-followup-plan',
      check: ctx => ctx.openTaskCount === 0 && ctx.daysSinceContact >= 90,
      action: 'Vurder å gjenoppta',
      detail: 'Ingen oppfølgingsplan — tid for ny vurdering?',
      priority: 'low',
    },
  ],
};

function getSuggestion(phase, ctx) {
  const rules = RULES[phase];
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.check(ctx)) {
      return { id: rule.id, action: rule.action, detail: rule.detail, priority: rule.priority };
    }
  }
  return null;
}

router.get('/api/playbook/suggestions', async (req, res) => {
  try {
    const [{ rows: investors }, { rows: logs }, { rows: tasks }, { rows: piRows }] = await Promise.all([
      query(`SELECT id, name, phase, lead, investor_type, last_contact, docs, next_steps
             FROM investors WHERE deleted_at IS NULL
             AND phase IN ('Prospekt', 'Aktiv dialog', 'Investor', 'På vent')`),
      query('SELECT investor_id, date, log_type, status FROM contact_log ORDER BY date'),
      query('SELECT investor_id, label, due_date, done FROM tasks'),
      query(`SELECT investor_id, SUM(target_ticket) AS total_ticket
             FROM product_investors WHERE target_ticket IS NOT NULL
             GROUP BY investor_id`),
    ]);

    const logsByInv  = {};
    for (const l of logs)  { (logsByInv[l.investor_id]  ||= []).push(l); }
    const tasksByInv = {};
    for (const t of tasks) { (tasksByInv[t.investor_id] ||= []).push(t); }
    const ticketMap = Object.fromEntries(piRows.map(r => [r.investor_id, Number(r.total_ticket)]));

    const suggestions = [];
    for (const inv of investors) {
      const ctx = buildContext(inv, logsByInv[inv.id] || [], tasksByInv[inv.id] || []);
      const suggestion = getSuggestion(inv.phase, ctx);
      if (!suggestion) continue;

      suggestions.push({
        investor_id:        inv.id,
        investor_name:      inv.name,
        phase:              inv.phase,
        lead:               inv.lead,
        investor_type:      inv.investor_type,
        last_contact:       inv.last_contact,
        days_since_contact: ctx.daysSinceContact,
        target_ticket:      ticketMap[inv.id] || null,
        next_steps:         inv.next_steps,
        suggestion,
        progress: {
          has_contact:    ctx.logCount > 0,
          has_deck:       ctx.hasDeck,
          has_meeting:    ctx.hasMeeting,
          has_im_ppm:     ctx.hasImPpm,
          has_fondsvilkar: ctx.hasFondsvilkar,
          activity_count: ctx.logCount,
          planned_count:  ctx.plannedCount,
        },
      });
    }

    const pOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) =>
      (pOrder[a.suggestion.priority] ?? 3) - (pOrder[b.suggestion.priority] ?? 3)
      || b.days_since_contact - a.days_since_contact
    );

    res.json(suggestions);
  } catch (e) {
    console.error('[playbook/suggestions]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/playbook/benchmarks', async (req, res) => {
  try {
    const [{ rows: investors }, { rows: logs }] = await Promise.all([
      query('SELECT id, phase, docs, last_contact FROM investors WHERE deleted_at IS NULL'),
      query(`SELECT investor_id, date, log_type, status
             FROM contact_log WHERE status IS DISTINCT FROM 'planlagt' ORDER BY date`),
    ]);

    const logsByInv = {};
    for (const l of logs) { (logsByInv[l.investor_id] ||= []).push(l); }

    const phaseDistribution = {};
    for (const inv of investors) {
      phaseDistribution[inv.phase] = (phaseDistribution[inv.phase] || 0) + 1;
    }

    const converted = investors.filter(i => i.phase === 'Investor');
    const convertedStats = { count: converted.length };

    if (converted.length > 0) {
      let totalActivities = 0, totalDays = 0, daysCount = 0;
      const typeCount = {};
      let deckN = 0, imPpmN = 0, fondsvilkarN = 0, ndaN = 0;

      for (const inv of converted) {
        const invLogs = logsByInv[inv.id] || [];
        totalActivities += invLogs.length;

        for (const l of invLogs) {
          const t = l.log_type || 'Annet';
          typeCount[t] = (typeCount[t] || 0) + 1;
        }

        if (invLogs.length >= 2) {
          const first = new Date(invLogs[0].date);
          const last  = new Date(invLogs[invLogs.length - 1].date);
          const days  = Math.floor((last - first) / 86400000);
          if (days > 0) { totalDays += days; daysCount++; }
        }

        const docs = inv.docs || {};
        let hasDeck = false, hasImPpm = false, hasFondsvilkar = false, hasNda = false;
        for (const pd of Object.values(docs)) {
          if (pd.deck?.done)        hasDeck = true;
          if (pd.im_ppm?.done)      hasImPpm = true;
          if (pd.fondsvilkar?.done) hasFondsvilkar = true;
          if (pd.nda?.done)         hasNda = true;
        }
        if (hasDeck)        deckN++;
        if (hasImPpm)       imPpmN++;
        if (hasFondsvilkar) fondsvilkarN++;
        if (hasNda)         ndaN++;
      }

      convertedStats.avgActivities     = Math.round(totalActivities / converted.length * 10) / 10;
      convertedStats.avgDaysToConvert   = daysCount > 0 ? Math.round(totalDays / daysCount) : null;
      convertedStats.activityTypes      = Object.entries(typeCount)
        .map(([type, count]) => ({ type, count, pct: Math.round(count / totalActivities * 100) }))
        .sort((a, b) => b.count - a.count);
      convertedStats.docCompletion = {
        deck:        Math.round(deckN / converted.length * 100),
        im_ppm:      Math.round(imPpmN / converted.length * 100),
        fondsvilkar: Math.round(fondsvilkarN / converted.length * 100),
        nda:         Math.round(ndaN / converted.length * 100),
      };
    }

    const pipeline = investors.filter(i => ['Prospekt', 'Aktiv dialog'].includes(i.phase));
    let pipelineAct = 0;
    for (const inv of pipeline) pipelineAct += (logsByInv[inv.id] || []).length;

    res.json({
      phaseDistribution,
      converted: convertedStats,
      pipeline: {
        count: pipeline.length,
        avgActivities: pipeline.length > 0 ? Math.round(pipelineAct / pipeline.length * 10) / 10 : 0,
      },
      totalInvestors: investors.length,
    });
  } catch (e) {
    console.error('[playbook/benchmarks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
